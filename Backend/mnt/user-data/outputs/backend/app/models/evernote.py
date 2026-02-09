# backend/app/models/evernote.py
from datetime import datetime
from sqlalchemy import (
    Column, Integer, BigInteger, String, Text, Boolean,
    DateTime, ForeignKey, UniqueConstraint
)
from sqlalchemy.orm import relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Evernote OAuth
    evernote_user_id = Column(BigInteger, unique=True)
    evernote_token = Column(Text)  # encrypt in production
    evernote_shard = Column(String(10))
    token_expires_at = Column(DateTime(timezone=True))
    last_sync_at = Column(DateTime(timezone=True))

    is_active = Column(Boolean, default=True)

    # Relations
    notebooks = relationship("Notebook", back_populates="user", cascade="all, delete-orphan")
    notes = relationship("Note", back_populates="source_user", foreign_keys="Note.source_user_id")

    @property
    def is_evernote_connected(self) -> bool:
        return bool(self.evernote_token and self.token_expires_at and self.token_expires_at > datetime.utcnow())

    def __repr__(self):
        return f"<User {self.name} ({self.email})>"


class Notebook(Base):
    __tablename__ = "notebooks"
    __table_args__ = (UniqueConstraint("user_id", "notebook_guid"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    notebook_guid = Column(String(64), nullable=False)
    name = Column(String(255), nullable=False)
    stack = Column(String(255))

    # Sharing
    is_shared = Column(Boolean, default=False)
    shared_from = Column(String(255))
    shared_notebook_guid = Column(String(64))
    privilege = Column(String(20), default="READ")

    # Sync
    usn = Column(Integer, default=0)
    sync_enabled = Column(Boolean, default=True)
    last_sync_at = Column(DateTime(timezone=True))

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relations
    user = relationship("User", back_populates="notebooks")
    notes = relationship("Note", back_populates="notebook")

    def __repr__(self):
        prefix = "[공유] " if self.is_shared else ""
        return f"<Notebook {prefix}{self.name}>"


class Note(Base):
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True)

    evernote_guid = Column(String(64), unique=True, nullable=False)
    notebook_id = Column(Integer, ForeignKey("notebooks.id", ondelete="SET NULL"))
    source_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    title = Column(String(500), nullable=False)
    plain_text = Column(Text)
    enml_content = Column(Text)
    content_hash = Column(String(32))
    content_length = Column(Integer, default=0)

    source_url = Column(Text)
    author = Column(String(255))

    # AI-enriched
    company = Column(String(255))
    sector = Column(String(100))
    sentiment = Column(String(20))

    # Evernote timestamps
    en_created = Column(DateTime(timezone=True))
    en_updated = Column(DateTime(timezone=True))

    # System
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    is_deleted = Column(Boolean, default=False)

    # Relations
    notebook = relationship("Notebook", back_populates="notes")
    source_user = relationship("User", back_populates="notes", foreign_keys=[source_user_id])
    tags = relationship("Tag", secondary="note_tags", back_populates="notes")
    accessed_by = relationship("NoteAccess", back_populates="note", cascade="all, delete-orphan")


class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True)
    evernote_guid = Column(String(64), unique=True)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    notes = relationship("Note", secondary="note_tags", back_populates="tags")


class NoteTag(Base):
    __tablename__ = "note_tags"

    note_id = Column(Integer, ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True)
    tag_id = Column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)


class NoteAccess(Base):
    __tablename__ = "note_access"

    note_id = Column(Integer, ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    access_type = Column(String(20), default="SYNC")
    synced_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    note = relationship("Note", back_populates="accessed_by")
    user = relationship("User")


class SyncLog(Base):
    __tablename__ = "sync_log"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    sync_type = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False)
    notes_synced = Column(Integer, default=0)
    notebooks_synced = Column(Integer, default=0)
    error_message = Column(Text)
    started_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    finished_at = Column(DateTime(timezone=True))

    user = relationship("User")
