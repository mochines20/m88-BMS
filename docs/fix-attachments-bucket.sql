-- Fix attachments bucket and RLS policies
-- Run this in Supabase SQL Editor

-- Step 1: Create bucket if not exists (using storage.create_bucket if available)
-- Or insert directly:
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, owner, created_at, updated_at, avif_autodetection)
VALUES (
  'attachments',
  'attachments',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  null,
  now(),
  now(),
  false
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

-- Step 2: Drop existing policies for this bucket to avoid conflicts
DO $$
BEGIN
  DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
  DROP POLICY IF EXISTS "Allow authenticated reads" ON storage.objects;
  DROP POLICY IF EXISTS "Allow owners to delete" ON storage.objects;
  DROP POLICY IF EXISTS "Allow all authenticated uploads" ON storage.objects;
  DROP POLICY IF EXISTS "Allow all authenticated reads" ON storage.objects;
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;

-- Step 3: Create new policies with proper checks
-- Policy 1: Allow authenticated users to upload to attachments bucket
CREATE POLICY "Allow all authenticated uploads"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'attachments');

-- Policy 2: Allow authenticated users to read from attachments bucket
CREATE POLICY "Allow all authenticated reads"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'attachments');

-- Policy 3: Allow authenticated users to delete from attachments bucket
CREATE POLICY "Allow all authenticated deletes"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'attachments');

-- Policy 4: Allow public read access (optional - for viewing without auth)
CREATE POLICY "Allow public reads"
ON storage.objects
FOR SELECT
TO anon
USING (bucket_id = 'attachments');

-- Step 4: Enable RLS on storage.objects (if not already enabled)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Step 5: Grant usage on storage schema to authenticated users
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT ALL ON storage.objects TO authenticated;
GRANT ALL ON storage.buckets TO authenticated;

-- Step 6: Grant sequence access
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA storage TO authenticated;
