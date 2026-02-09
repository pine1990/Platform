-- ============================================================
-- Research Platform DB Schema
-- PostgreSQL 15+
-- ============================================================

-- ─── Users & Auth ────────────────────────────────────────────
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    email           VARCHAR(255) UNIQUE NOT NULL,
    name            VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    -- Evernote OAuth
    evernote_user_id    BIGINT UNIQUE,          -- Evernote internal user ID
    evernote_token      TEXT,                    -- OAuth access token (encrypted at rest)
    evernote_shard      VARCHAR(10),             -- shard ID (s1, s2, ...)
    token_expires_at    TIMESTAMPTZ,             -- token expiry (default 1yr)
    last_sync_at        TIMESTAMPTZ,             -- last successful sync time

    is_active       BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_users_evernote_uid ON users(evernote_user_id);


-- ─── Evernote Notebooks (own + shared/linked) ───────────────
CREATE TABLE notebooks (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Evernote identifiers
    notebook_guid   VARCHAR(64) NOT NULL,       -- Evernote notebook GUID
    name            VARCHAR(255) NOT NULL,
    stack           VARCHAR(255),               -- notebook stack name

    -- Sharing info
    is_shared       BOOLEAN DEFAULT FALSE,      -- is this a LinkedNotebook?
    shared_from     VARCHAR(255),               -- owner's display name (if shared)
    shared_notebook_guid VARCHAR(64),           -- SharedNotebook GUID (if linked)
    privilege       VARCHAR(20) DEFAULT 'READ', -- READ / MODIFY / FULL

    -- Sync control
    usn             INT DEFAULT 0,              -- Update Sequence Number for incremental sync
    sync_enabled    BOOLEAN DEFAULT TRUE,       -- user can disable per-notebook sync
    last_sync_at    TIMESTAMPTZ,

    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, notebook_guid)
);

CREATE INDEX idx_notebooks_user ON notebooks(user_id);


-- ─── Notes ───────────────────────────────────────────────────
CREATE TABLE notes (
    id              SERIAL PRIMARY KEY,

    -- Evernote identifiers (dedup key)
    evernote_guid   VARCHAR(64) UNIQUE NOT NULL, -- globally unique across all users
    notebook_id     INT REFERENCES notebooks(id) ON DELETE SET NULL,

    -- Who brought this note in
    source_user_id  INT NOT NULL REFERENCES users(id),

    -- Content
    title           VARCHAR(500) NOT NULL,
    plain_text      TEXT,                       -- stripped text for search & AI
    enml_content    TEXT,                       -- original ENML for rendering
    content_hash    VARCHAR(32),                -- MD5 for change detection
    content_length  INT DEFAULT 0,

    -- Metadata
    source_url      TEXT,
    author          VARCHAR(255),

    -- Extracted fields (AI-enriched later)
    company         VARCHAR(255),               -- extracted company name
    sector          VARCHAR(100),               -- extracted sector
    sentiment       VARCHAR(20),                -- positive / neutral / negative

    -- Evernote timestamps
    en_created      TIMESTAMPTZ,
    en_updated      TIMESTAMPTZ,

    -- System timestamps
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    is_deleted      BOOLEAN DEFAULT FALSE       -- soft delete
);

CREATE INDEX idx_notes_guid ON notes(evernote_guid);
CREATE INDEX idx_notes_source_user ON notes(source_user_id);
CREATE INDEX idx_notes_company ON notes(company);
CREATE INDEX idx_notes_created ON notes(en_created);

-- Full text search (Korean)
-- Requires: CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_notes_title_trgm ON notes USING gin(title gin_trgm_ops);
CREATE INDEX idx_notes_text_trgm ON notes USING gin(plain_text gin_trgm_ops);


-- ─── Note Tags ───────────────────────────────────────────────
CREATE TABLE tags (
    id              SERIAL PRIMARY KEY,
    evernote_guid   VARCHAR(64) UNIQUE,
    name            VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE note_tags (
    note_id         INT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id          INT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX idx_tags_name ON tags(name);


-- ─── Note Access Log (who can see what) ──────────────────────
-- When multiple users share the same note, track all of them
CREATE TABLE note_access (
    note_id         INT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_type     VARCHAR(20) DEFAULT 'SYNC', -- SYNC / SHARED / MANUAL
    synced_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (note_id, user_id)
);


-- ─── Sync Log (debugging & monitoring) ───────────────────────
CREATE TABLE sync_log (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id),
    sync_type       VARCHAR(20) NOT NULL,       -- FULL / INCREMENTAL / SHARED
    status          VARCHAR(20) NOT NULL,       -- STARTED / SUCCESS / FAILED
    notes_synced    INT DEFAULT 0,
    notebooks_synced INT DEFAULT 0,
    error_message   TEXT,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    finished_at     TIMESTAMPTZ
);


-- ─── Companies (master list) ─────────────────────────────────
CREATE TABLE companies (
    id              SERIAL PRIMARY KEY,
    stock_code      VARCHAR(10) UNIQUE NOT NULL, -- 005930, 000660, ...
    name            VARCHAR(100) NOT NULL,
    name_en         VARCHAR(100),
    sector          VARCHAR(100),
    market          VARCHAR(10),                -- KOSPI / KOSDAQ
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_companies_name ON companies(name);


-- ─── Stock Prices (daily OHLCV) ─────────────────────────────
CREATE TABLE stock_prices (
    id              SERIAL PRIMARY KEY,
    company_id      INT NOT NULL REFERENCES companies(id),
    trade_date      DATE NOT NULL,
    open            INT NOT NULL,
    high            INT NOT NULL,
    low             INT NOT NULL,
    close           INT NOT NULL,
    volume          BIGINT NOT NULL,
    change_pct      DECIMAL(8,4),               -- daily % change

    UNIQUE(company_id, trade_date)
);

CREATE INDEX idx_stock_prices_date ON stock_prices(company_id, trade_date DESC);


-- ─── Chart Events (unified timeline) ────────────────────────
CREATE TABLE chart_events (
    id              SERIAL PRIMARY KEY,
    company_id      INT REFERENCES companies(id),
    event_date      DATE NOT NULL,
    event_type      VARCHAR(20) NOT NULL,       -- note / news / telegram / earnings / report
    label           VARCHAR(255) NOT NULL,
    detail          TEXT,
    source_id       INT,                        -- FK to notes.id or news.id etc.
    source_table    VARCHAR(50),                -- 'notes', 'news_articles', etc.
    color           VARCHAR(7),                 -- hex color override
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chart_events_company_date ON chart_events(company_id, event_date);


-- ─── Placeholder tables for Phase 2-3 ───────────────────────

CREATE TABLE news_clusters (
    id              SERIAL PRIMARY KEY,
    company_id      INT REFERENCES companies(id),
    topic           VARCHAR(255),
    keyword         VARCHAR(50),
    cluster_date    DATE,
    impact_score    INT DEFAULT 0,
    price_impact    DECIMAL(6,2),
    sentiment       VARCHAR(20),
    article_count   INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE news_articles (
    id              SERIAL PRIMARY KEY,
    cluster_id      INT REFERENCES news_clusters(id),
    company_id      INT REFERENCES companies(id),
    title           VARCHAR(500),
    source          VARCHAR(100),
    url             TEXT,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE telegram_mentions (
    id              SERIAL PRIMARY KEY,
    company_id      INT REFERENCES companies(id),
    channel_name    VARCHAR(100),
    message_text    TEXT,
    sentiment       VARCHAR(20),
    mentioned_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE analyst_reports (
    id              SERIAL PRIMARY KEY,
    company_id      INT REFERENCES companies(id),
    broker          VARCHAR(100),
    analyst         VARCHAR(100),
    title           VARCHAR(500),
    target_price    INT,
    rating          VARCHAR(20),
    published_at    DATE,
    file_url        TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE financials (
    id              SERIAL PRIMARY KEY,
    company_id      INT REFERENCES companies(id),
    fiscal_year     INT NOT NULL,
    fiscal_quarter  INT,                        -- NULL = annual
    revenue         BIGINT,
    operating_profit BIGINT,
    net_income      BIGINT,
    eps             INT,
    per             DECIMAL(8,2),
    pbr             DECIMAL(8,2),
    dividend_yield  DECIMAL(6,2),
    source          VARCHAR(20) DEFAULT 'DART',
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(company_id, fiscal_year, fiscal_quarter)
);
