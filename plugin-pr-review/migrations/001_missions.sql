CREATE TABLE plugin_pr_review_29fb956b15.missions (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  repository text NOT NULL,
  pr_number integer NOT NULL CHECK (pr_number > 0),
  version integer NOT NULL DEFAULT 0,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, repository, pr_number)
);
