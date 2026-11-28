-- Backstop: reject entries whose body or trigger looks like it stores a raw secret.
-- Primary check lives in src/core/validate.ts (SECRET_PATTERNS); this constraint
-- catches direct Studio writes that bypass the CLI.
alter table public.memories
  add constraint body_not_secret check (
    body !~* '\+\d{9,}' and
    body !~* 'password[^.]*[!@#$%^&*]'
  );
alter table public.memories
  add constraint trigger_not_secret check (
    trigger !~* '\+\d{9,}' and
    trigger !~* 'password[^.]*[!@#$%^&*]'
  );