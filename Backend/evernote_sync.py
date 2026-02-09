# backend/app/services/evernote_sync.py
"""
Evernote Sync Service
─────────────────────
Handles:
1. OAuth token acquisition per user
2. Sync user's own notebooks + notes
3. Sync LinkedNotebooks (shared from others)
4. Incremental sync via USN (Update Sequence Number)
5. Deduplication by evernote_guid
"""

import hashlib
import html
import re
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from evernote.api.client import EvernoteClient
from evernote.edam.notestore.ttypes import NoteFilter, NotesMetadataResultSpec
from evernote.edam.type.ttypes import Note as ENNote

from app.config import get_settings
from app.models.evernote import User, Notebook, Note, Tag, NoteTag, NoteAccess, SyncLog

logger = logging.getLogger(__name__)
settings = get_settings()


# ─── ENML → Plain Text ─────────────────────────────────────────
def strip_enml(enml_content: str) -> str:
    """Strip ENML/HTML tags to get plain text for search & AI."""
    if not enml_content:
        return ""
    text = re.sub(r'<!\[CDATA\[', '', enml_content)
    text = re.sub(r'\]\]>', '', text)
    text = re.sub(r'<en-note[^>]*>', '', text)
    text = re.sub(r'</en-note>', '', text)
    text = re.sub(r'<en-media[^>]*/>', '', text)  # remove embedded resources
    text = re.sub(r'<[^>]+>', '', text)            # strip remaining HTML
    text = html.unescape(text)
    return text.strip()


def en_timestamp_to_datetime(ts: Optional[int]) -> Optional[datetime]:
    """Convert Evernote timestamp (ms since epoch) to datetime."""
    if not ts:
        return None
    return datetime.fromtimestamp(ts / 1000, tz=timezone.utc)


# ─── OAuth Helper ───────────────────────────────────────────────
def get_evernote_client(token: str = None) -> EvernoteClient:
    return EvernoteClient(
        consumer_key=settings.EVERNOTE_CONSUMER_KEY,
        consumer_secret=settings.EVERNOTE_CONSUMER_SECRET,
        sandbox=settings.EVERNOTE_SANDBOX,
        token=token,
    )


def get_oauth_request_token(callback_url: str) -> dict:
    """Step 1: Get request token for OAuth flow."""
    client = get_evernote_client()
    request_token = client.get_request_token(callback_url)
    return {
        "oauth_token": request_token["oauth_token"],
        "oauth_token_secret": request_token["oauth_token_secret"],
        "authorize_url": client.get_authorize_url(request_token),
    }


def get_oauth_access_token(
    oauth_token: str, oauth_token_secret: str, oauth_verifier: str
) -> dict:
    """Step 2: Exchange verifier for access token."""
    client = get_evernote_client()
    access_token = client.get_access_token(
        oauth_token, oauth_token_secret, oauth_verifier
    )
    # access_token is a string like "S=s432:U=4a535ee:E=154d..."
    # Parse edam_userId, edam_shard, edam_expires from it
    return {
        "token": access_token,
    }


# ─── Sync: Own Notebooks ───────────────────────────────────────
async def sync_own_notebooks(db: AsyncSession, user: User) -> list[Notebook]:
    """Sync user's own notebooks from Evernote."""
    client = get_evernote_client(token=user.evernote_token)
    note_store = client.get_note_store()

    en_notebooks = note_store.listNotebooks()
    synced = []

    for nb in en_notebooks:
        # Upsert notebook
        stmt = pg_insert(Notebook.__table__).values(
            user_id=user.id,
            notebook_guid=nb.guid,
            name=nb.name,
            stack=nb.stack,
            is_shared=False,
            usn=nb.updateSequenceNum or 0,
        ).on_conflict_do_update(
            index_elements=["user_id", "notebook_guid"],
            set_={
                "name": nb.name,
                "stack": nb.stack,
                "usn": nb.updateSequenceNum or 0,
                "updated_at": datetime.utcnow(),
            },
        )
        await db.execute(stmt)

        # Get or create the Notebook ORM object
        result = await db.execute(
            select(Notebook).where(
                and_(Notebook.user_id == user.id, Notebook.notebook_guid == nb.guid)
            )
        )
        notebook = result.scalar_one()
        synced.append(notebook)

    await db.commit()
    logger.info(f"[{user.name}] Synced {len(synced)} own notebooks")
    return synced


# ─── Sync: Linked (Shared) Notebooks ───────────────────────────
async def sync_linked_notebooks(db: AsyncSession, user: User) -> list[Notebook]:
    """Sync notebooks shared TO this user from other Evernote users."""
    client = get_evernote_client(token=user.evernote_token)
    note_store = client.get_note_store()

    linked_notebooks = note_store.listLinkedNotebooks()
    synced = []

    for lnb in linked_notebooks:
        # Get shared notebook store & auth token
        shared_note_store = client.getSharedNoteStore(lnb)
        shared_nb = shared_note_store.getSharedNotebookByAuth()

        # Determine owner name
        shared_from = lnb.username or lnb.shareName or "Unknown"

        stmt = pg_insert(Notebook.__table__).values(
            user_id=user.id,
            notebook_guid=shared_nb.notebookGuid,
            name=lnb.shareName or "Shared Notebook",
            is_shared=True,
            shared_from=shared_from,
            shared_notebook_guid=str(shared_nb.id) if shared_nb.id else None,
            privilege=_map_privilege(shared_nb.privilege),
        ).on_conflict_do_update(
            index_elements=["user_id", "notebook_guid"],
            set_={
                "name": lnb.shareName or "Shared Notebook",
                "shared_from": shared_from,
                "updated_at": datetime.utcnow(),
            },
        )
        await db.execute(stmt)

        result = await db.execute(
            select(Notebook).where(
                and_(
                    Notebook.user_id == user.id,
                    Notebook.notebook_guid == shared_nb.notebookGuid,
                )
            )
        )
        notebook = result.scalar_one()
        # Store the shared note store reference for note sync
        notebook._shared_note_store = shared_note_store
        notebook._shared_nb_guid = shared_nb.notebookGuid
        synced.append(notebook)

    await db.commit()
    logger.info(f"[{user.name}] Synced {len(synced)} linked notebooks")
    return synced


def _map_privilege(priv) -> str:
    """Map Evernote SharedNotebookPrivilegeLevel to string."""
    mapping = {
        1: "READ",
        2: "MODIFY",
        3: "FULL",
    }
    return mapping.get(priv, "READ")


# ─── Sync: Notes in a Notebook ──────────────────────────────────
async def sync_notes_in_notebook(
    db: AsyncSession,
    user: User,
    notebook: Notebook,
    note_store=None,
    full_sync: bool = False,
) -> int:
    """
    Sync all notes in a given notebook.
    Handles deduplication: if another user already synced the same note (same GUID),
    we just add a NoteAccess record instead of duplicating.
    """
    if not notebook.sync_enabled:
        return 0

    if note_store is None:
        client = get_evernote_client(token=user.evernote_token)
        # For linked notebooks, use the shared note store
        if notebook.is_shared and hasattr(notebook, '_shared_note_store'):
            note_store = notebook._shared_note_store
        else:
            note_store = client.get_note_store()

    # Set up note filter
    note_filter = NoteFilter()
    if notebook.is_shared and hasattr(notebook, '_shared_nb_guid'):
        note_filter.notebookGuid = notebook._shared_nb_guid
    else:
        note_filter.notebookGuid = notebook.notebook_guid

    # What fields to fetch in metadata
    result_spec = NotesMetadataResultSpec(
        includeTitle=True,
        includeCreated=True,
        includeUpdated=True,
        includeContentLength=True,
        includeNotebookGuid=True,
        includeTagGuids=True,
    )

    offset = 0
    batch_size = 50
    total_synced = 0

    while True:
        notes_metadata = note_store.findNotesMetadata(
            note_filter, offset, batch_size, result_spec
        )

        if not notes_metadata.notes:
            break

        for meta in notes_metadata.notes:
            synced = await _sync_single_note(
                db, user, notebook, note_store, meta
            )
            if synced:
                total_synced += 1

        offset += batch_size
        if offset >= notes_metadata.totalNotes:
            break

    # Update notebook sync time
    notebook.last_sync_at = datetime.utcnow()
    await db.commit()

    logger.info(f"[{user.name}] Synced {total_synced} notes in '{notebook.name}'")
    return total_synced


async def _sync_single_note(
    db: AsyncSession,
    user: User,
    notebook: Notebook,
    note_store,
    meta,
) -> bool:
    """
    Sync a single note. Returns True if new/updated.

    Dedup logic:
    - If evernote_guid already exists → check content_hash
      - Same hash → just ensure NoteAccess exists, skip
      - Different hash → update content
    - If new → insert note + NoteAccess
    """
    guid = meta.guid

    # Check if note already exists in DB
    result = await db.execute(
        select(Note).where(Note.evernote_guid == guid)
    )
    existing = result.scalar_one_or_none()

    if existing:
        # Note already synced by someone — just add access
        await _ensure_note_access(db, existing.id, user.id)

        # Check if content changed (compare content hash)
        en_note = note_store.getNote(guid, True, False, False, False)
        new_hash = hashlib.md5(
            (en_note.content or "").encode()
        ).hexdigest()

        if existing.content_hash == new_hash:
            return False  # No changes

        # Content updated — refresh
        existing.title = en_note.title or existing.title
        existing.enml_content = en_note.content
        existing.plain_text = strip_enml(en_note.content)
        existing.content_hash = new_hash
        existing.content_length = en_note.contentLength or 0
        existing.en_updated = en_timestamp_to_datetime(en_note.updated)
        existing.updated_at = datetime.utcnow()

        await _sync_note_tags(db, existing.id, note_store, en_note.tagGuids)
        await db.commit()
        return True

    # New note — fetch full content
    en_note = note_store.getNote(guid, True, False, False, False)
    content_hash = hashlib.md5((en_note.content or "").encode()).hexdigest()
    plain_text = strip_enml(en_note.content)

    note = Note(
        evernote_guid=guid,
        notebook_id=notebook.id,
        source_user_id=user.id,
        title=en_note.title or "Untitled",
        plain_text=plain_text,
        enml_content=en_note.content,
        content_hash=content_hash,
        content_length=en_note.contentLength or 0,
        source_url=en_note.attributes.sourceURL if en_note.attributes else None,
        author=en_note.attributes.author if en_note.attributes else None,
        en_created=en_timestamp_to_datetime(en_note.created),
        en_updated=en_timestamp_to_datetime(en_note.updated),
    )
    db.add(note)
    await db.flush()  # get note.id

    # NoteAccess
    await _ensure_note_access(db, note.id, user.id)

    # Tags
    await _sync_note_tags(db, note.id, note_store, en_note.tagGuids)

    await db.commit()
    return True


async def _ensure_note_access(db: AsyncSession, note_id: int, user_id: int):
    """Add user→note access record if not exists."""
    stmt = pg_insert(NoteAccess.__table__).values(
        note_id=note_id,
        user_id=user_id,
        access_type="SYNC",
        synced_at=datetime.utcnow(),
    ).on_conflict_do_nothing(index_elements=["note_id", "user_id"])
    await db.execute(stmt)


async def _sync_note_tags(
    db: AsyncSession, note_id: int, note_store, tag_guids: list
):
    """Sync tags for a note."""
    if not tag_guids:
        return

    for tguid in tag_guids:
        # Get or create tag
        result = await db.execute(
            select(Tag).where(Tag.evernote_guid == tguid)
        )
        tag = result.scalar_one_or_none()

        if not tag:
            try:
                en_tag = note_store.getTag(tguid)
                tag = Tag(evernote_guid=tguid, name=en_tag.name)
                db.add(tag)
                await db.flush()
            except Exception:
                continue

        # Link note ↔ tag
        stmt = pg_insert(NoteTag.__table__).values(
            note_id=note_id, tag_id=tag.id
        ).on_conflict_do_nothing()
        await db.execute(stmt)


# ─── Full Sync Orchestrator ─────────────────────────────────────
async def full_sync_user(db: AsyncSession, user: User) -> dict:
    """
    Full sync for a user:
    1. Sync own notebooks
    2. Sync linked (shared) notebooks
    3. Sync notes in each notebook
    """
    if not user.is_evernote_connected:
        raise ValueError(f"User {user.name} has no valid Evernote token")

    log = SyncLog(
        user_id=user.id,
        sync_type="FULL",
        status="STARTED",
    )
    db.add(log)
    await db.commit()

    try:
        # 1. Own notebooks
        own_notebooks = await sync_own_notebooks(db, user)

        # 2. Linked notebooks
        linked_notebooks = await sync_linked_notebooks(db, user)

        # 3. Sync notes
        total_notes = 0
        all_notebooks = own_notebooks + linked_notebooks

        for notebook in all_notebooks:
            count = await sync_notes_in_notebook(
                db, user, notebook, full_sync=True
            )
            total_notes += count

        # Update user last_sync
        user.last_sync_at = datetime.utcnow()

        # Log success
        log.status = "SUCCESS"
        log.notebooks_synced = len(all_notebooks)
        log.notes_synced = total_notes
        log.finished_at = datetime.utcnow()
        await db.commit()

        return {
            "notebooks": len(all_notebooks),
            "own": len(own_notebooks),
            "shared": len(linked_notebooks),
            "notes": total_notes,
        }

    except Exception as e:
        log.status = "FAILED"
        log.error_message = str(e)
        log.finished_at = datetime.utcnow()
        await db.commit()
        logger.error(f"Sync failed for {user.name}: {e}")
        raise
