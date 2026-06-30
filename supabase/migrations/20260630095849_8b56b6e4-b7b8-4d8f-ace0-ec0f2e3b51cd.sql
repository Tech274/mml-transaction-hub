-- RLS policies for the bulk-imports storage bucket.
-- Files are stored under "<user_id>/<run_id>/..." so name LIKE '<uid>/%' scopes to the owner.

CREATE POLICY "bulk-imports: owners read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'bulk-imports'
    AND (
      name LIKE (auth.uid()::text || '/%')
      OR public.has_any_role(auth.uid(), ARRAY['admin','ops_lead']::app_role[])
    )
  );

CREATE POLICY "bulk-imports: owners insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'bulk-imports'
    AND name LIKE (auth.uid()::text || '/%')
    AND public.has_any_role(auth.uid(), ARRAY['admin','ops_lead','ops_user']::app_role[])
  );

CREATE POLICY "bulk-imports: owners update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'bulk-imports'
    AND name LIKE (auth.uid()::text || '/%')
  );

CREATE POLICY "bulk-imports: owners delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'bulk-imports'
    AND name LIKE (auth.uid()::text || '/%')
  );
