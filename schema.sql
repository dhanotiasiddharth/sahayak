-- Sahayak Postgres schema (pilot). One database, tenant_id on every row.
create table tenants (id text primary key, name text not null, connector text not null, config jsonb not null default '{}', created_at timestamptz default now());
create table users (id text primary key, tenant_id text references tenants(id), name text, phone text, role text check (role in ('rep','manager','admin')), manager_id text, beat jsonb, sso_subject text, created_at timestamptz default now());
create table visits (id text primary key, tenant_id text references tenants(id), rep_id text references users(id), dealer_id text, dealer_name text, date date, transcript text, summary text, complaint text, next_visit_date date, order_no text, order_total numeric, status text, created_at timestamptz default now());
create index on visits (tenant_id, rep_id, date);
create table rep_memory (tenant_id text, rep_id text, dealer_id text, note text, created_at timestamptz default now());
create index on rep_memory (tenant_id, rep_id, dealer_id);
create table audit_log (id bigserial primary key, tenant_id text, at timestamptz default now(), actor text, action text, target text, detail jsonb);
create index on audit_log (tenant_id, at desc);
create table whatsapp_messages (id text primary key, tenant_id text, visit_id text, to_phone text, body text, status text, wa_message_id text, created_at timestamptz default now());
