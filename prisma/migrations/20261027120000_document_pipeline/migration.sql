-- Upload reservations prevent arbitrary object keys and repeat finalization.
CREATE TABLE document_uploads (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 object_key TEXT NOT NULL UNIQUE,
 filename VARCHAR(255) NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 document_id UUID UNIQUE REFERENCES documents(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE document_jobs (
 id UUID PRIMARY KEY,
 document_id UUID NOT NULL UNIQUE REFERENCES documents(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','done','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 locked_at TIMESTAMPTZ,
 lease_id UUID,
 error_message TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_jobs_claim_idx ON document_jobs(status, available_at);
ALTER TABLE chat_history ADD COLUMN sources JSONB NOT NULL DEFAULT '[]'::jsonb;
