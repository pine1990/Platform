# backend/app/routers/evernote.py
"""
Evernote API Routes
───────────────────
POST /auth/evernote/start     → Start OAuth flow (get authorize URL)
GET  /auth/evernote/callback  → OAuth callback (exchange token)
POST /sync/{user_id}          → Trigger full sync
GET  /sync/{user_id}/status   → Last sync status
GET  /users/{user_id}/notebooks → List user's notebooks (own + shared)
GET  /users/{user_id}/notes    → List user's notes (with search/filter)
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from app.database import get_db
from app.config import get_settings
from app.models.evernote import User, Notebook, Note, NoteAccess, SyncLog
from app.services.evernote_sync import (
    get_oauth_request_token,
    get_oauth_access_token,
    full_sync_user,
)

router = APIRouter(prefix="/evernote", tags=["evernote"])
settings = get_settings()


# ─── Pydantic Schemas ────────────────────────────────────────────

class OAuthStartRequest(BaseModel):
    user_id: int
    callback_url: str  # e.g. https://yourapp.com/auth/evernote/callback


class OAuthStartResponse(BaseModel):
    authorize_url: str
    oauth_token: str


class OAuthCallbackRequest(BaseModel):
    user_id: int
    oauth_token: str
    oauth_token_secret: str
    oauth_verifier: str


class SyncResponse(BaseModel):
    notebooks: int
    own: int
    shared: int
    notes: int


class NotebookOut(BaseModel):
    id: int
    name: str
    is_shared: bool
    shared_from: Optional[str]
    note_count: int = 0
    sync_enabled: bool
    last_sync_at: Optional[datetime]


class NoteOut(BaseModel):
    id: int
    title: str
    plain_text: Optional[str]
    company: Optional[str]
    tags: list[str] = []
    notebook_name: Optional[str]
    is_shared: bool = False
    shared_from: Optional[str]
    source_user: str
    en_created: Optional[datetime]
    en_updated: Optional[datetime]


class NotesListResponse(BaseModel):
    total: int
    notes: list[NoteOut]


# ─── OAuth Routes ────────────────────────────────────────────────

@router.post("/auth/start", response_model=OAuthStartResponse)
async def oauth_start(req: OAuthStartRequest, db: AsyncSession = Depends(get_db)):
    """Step 1: Generate Evernote OAuth authorization URL."""
    user = await db.get(User, req.user_id)
    if not user:
        raise HTTPException(404, "User not found")

    result = get_oauth_request_token(req.callback_url)

    # Store oauth_token_secret in session/cache (in production, use Redis)
    # For now, return it to client to pass back in callback
    return OAuthStartResponse(
        authorize_url=result["authorize_url"],
        oauth_token=result["oauth_token"],
    )


@router.post("/auth/callback")
async def oauth_callback(req: OAuthCallbackRequest, db: AsyncSession = Depends(get_db)):
    """Step 2: Exchange OAuth verifier for access token."""
    user = await db.get(User, req.user_id)
    if not user:
        raise HTTPException(404, "User not found")

    result = get_oauth_access_token(
        req.oauth_token, req.oauth_token_secret, req.oauth_verifier
    )
    token = result["token"]

    # Parse token metadata
    # Token format: S=s432:U=4a535ee:E=154dxxxx:C=xxxx:P=xxx:A=xxx:V=2:H=xxx
    parts = dict(p.split("=", 1) for p in token.split(":") if "=" in p)

    user.evernote_token = token
    user.evernote_shard = parts.get("S", "")
    user.evernote_user_id = int(parts.get("U", "0"), 16) if parts.get("U") else None

    # Token expires: "E" field is hex epoch in seconds
    if parts.get("E"):
        expires_epoch = int(parts["E"], 16)
        user.token_expires_at = datetime.fromtimestamp(expires_epoch, tz=timezone.utc)

    await db.commit()

    return {
        "status": "connected",
        "user_id": user.id,
        "evernote_user_id": user.evernote_user_id,
        "expires_at": user.token_expires_at.isoformat() if user.token_expires_at else None,
    }


# ─── Sync Routes ─────────────────────────────────────────────────

@router.post("/sync/{user_id}", response_model=SyncResponse)
async def trigger_sync(user_id: int, db: AsyncSession = Depends(get_db)):
    """Trigger full sync for a user (own + shared notebooks + all notes)."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if not user.is_evernote_connected:
        raise HTTPException(400, "Evernote not connected. Please complete OAuth first.")

    try:
        result = await full_sync_user(db, user)
        return SyncResponse(**result)
    except Exception as e:
        raise HTTPException(500, f"Sync failed: {str(e)}")


@router.get("/sync/{user_id}/status")
async def sync_status(user_id: int, db: AsyncSession = Depends(get_db)):
    """Get last sync status for a user."""
    result = await db.execute(
        select(SyncLog)
        .where(SyncLog.user_id == user_id)
        .order_by(SyncLog.started_at.desc())
        .limit(5)
    )
    logs = result.scalars().all()

    return {
        "user_id": user_id,
        "syncs": [
            {
                "id": log.id,
                "type": log.sync_type,
                "status": log.status,
                "notes_synced": log.notes_synced,
                "notebooks_synced": log.notebooks_synced,
                "error": log.error_message,
                "started_at": log.started_at.isoformat() if log.started_at else None,
                "finished_at": log.finished_at.isoformat() if log.finished_at else None,
            }
            for log in logs
        ],
    }


# ─── Data Routes ─────────────────────────────────────────────────

@router.get("/users/{user_id}/notebooks", response_model=list[NotebookOut])
async def list_notebooks(user_id: int, db: AsyncSession = Depends(get_db)):
    """List all notebooks for a user (own + shared)."""
    result = await db.execute(
        select(Notebook)
        .where(Notebook.user_id == user_id)
        .order_by(Notebook.is_shared, Notebook.name)
    )
    notebooks = result.scalars().all()

    out = []
    for nb in notebooks:
        # Count notes in this notebook
        count_result = await db.execute(
            select(func.count(Note.id)).where(Note.notebook_id == nb.id)
        )
        note_count = count_result.scalar() or 0

        out.append(NotebookOut(
            id=nb.id,
            name=nb.name,
            is_shared=nb.is_shared,
            shared_from=nb.shared_from,
            note_count=note_count,
            sync_enabled=nb.sync_enabled,
            last_sync_at=nb.last_sync_at,
        ))

    return out


@router.get("/users/{user_id}/notes", response_model=NotesListResponse)
async def list_notes(
    user_id: int,
    q: Optional[str] = Query(None, description="Search query"),
    tag: Optional[str] = Query(None, description="Filter by tag name"),
    company: Optional[str] = Query(None, description="Filter by company"),
    notebook_id: Optional[int] = Query(None),
    shared_only: bool = Query(False, description="Only show shared notes"),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    """
    List notes accessible by this user.
    Includes both own notes and notes shared from others (via NoteAccess).
    """
    # Base query: notes this user has access to
    query = (
        select(Note)
        .join(NoteAccess, NoteAccess.note_id == Note.id)
        .where(
            and_(
                NoteAccess.user_id == user_id,
                Note.is_deleted == False,
            )
        )
        .options(selectinload(Note.tags), selectinload(Note.notebook))
    )

    # Filters
    if q:
        search = f"%{q}%"
        query = query.where(
            (Note.title.ilike(search)) | (Note.plain_text.ilike(search))
        )

    if tag:
        query = query.join(Note.tags).where(func.lower(Note.tags.property.mapper.class_.name) == tag.lower())

    if company:
        query = query.where(Note.company == company)

    if notebook_id:
        query = query.where(Note.notebook_id == notebook_id)

    if shared_only:
        query = query.join(Notebook, Note.notebook_id == Notebook.id).where(Notebook.is_shared == True)

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Fetch with pagination
    query = query.order_by(Note.en_created.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    notes = result.scalars().all()

    # Build response
    note_outs = []
    for note in notes:
        nb = note.notebook
        source_user = await db.get(User, note.source_user_id)

        note_outs.append(NoteOut(
            id=note.id,
            title=note.title,
            plain_text=note.plain_text[:300] if note.plain_text else None,
            company=note.company,
            tags=[t.name for t in note.tags],
            notebook_name=nb.name if nb else None,
            is_shared=nb.is_shared if nb else False,
            shared_from=nb.shared_from if nb else None,
            source_user=source_user.name if source_user else "Unknown",
            en_created=note.en_created,
            en_updated=note.en_updated,
        ))

    return NotesListResponse(total=total, notes=note_outs)


@router.patch("/notebooks/{notebook_id}/toggle-sync")
async def toggle_notebook_sync(notebook_id: int, db: AsyncSession = Depends(get_db)):
    """Enable/disable sync for a specific notebook."""
    nb = await db.get(Notebook, notebook_id)
    if not nb:
        raise HTTPException(404, "Notebook not found")
    nb.sync_enabled = not nb.sync_enabled
    await db.commit()
    return {"notebook_id": nb.id, "sync_enabled": nb.sync_enabled}
