-- Allow users to delete their own org's personas (custom ones from the Agent Library UI)
create policy persona_delete on personas for delete
  using (org_id = public.user_org());
