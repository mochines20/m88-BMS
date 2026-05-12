-- Fix attachments bucket and RLS policies
-- Run this in Supabase SQL Editor
-- NOTE: If you get "must be owner of table objects" error, use the Supabase Dashboard > Storage section instead

-- Step 1: Create or update the bucket using Supabase Storage (recommended)
-- If you have the storage.create_bucket() function (Supabase v11+), use this instead:
/*
SELECT storage.create_bucket(
  id => 'attachments',
  name => 'attachments',
  public => true,
  file_size_limit => 10485760, -- 10MB
  allowed_mime_types => ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
);
*/

-- Step 2: Drop existing policies to avoid conflicts
DO $$ 
BEGIN 
  DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects; 
  DROP POLICY IF EXISTS "Allow authenticated reads" ON storage.objects; 
  DROP POLICY IF EXISTS "Allow owners to delete" ON storage.objects; 
  DROP POLICY IF EXISTS "Allow all authenticated uploads" ON storage.objects; 
  DROP POLICY IF EXISTS "Allow all authenticated reads" ON storage.objects;
  DROP POLICY IF EXISTS "Allow all authenticated deletes" ON storage.objects;
  DROP POLICY IF EXISTS "Allow public reads" ON storage.objects;
EXCEPTION 
  WHEN undefined_object THEN 
    NULL; 
END $$;

-- Step 3: Create RLS policies for storage.objects (these should work without ownership issues)
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

-- Policy 4: Allow public read access
CREATE POLICY "Allow public reads"
ON storage.objects
FOR SELECT
TO anon
USING (bucket_id = 'attachments');

-- Step 4: Enable RLS (if not already enabled)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- Alternative: If you still get ownership errors, use the Supabase Dashboard
-- ==========================================
-- 1. Go to https://supabase.com/dashboard
-- 2. Select your project
-- 3. Go to Storage > New Bucket
-- 4. Create a bucket called "attachments" with these settings:
--    - Public bucket: Yes
--    - File size limit: 10MB
--    - Allowed MIME types: image/*, application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
-- 5. Go to Storage > Policies
-- 6. Add these policies for the "attachments" bucket:
--
--    Policy Name: Allow all authenticated uploads
--    Allowed operation: INSERT
--    Target roles: authenticated
--    Policy definition: (bucket_id = 'attachments'::text)
--
--    Policy Name: Allow all authenticated reads
--    Allowed operation: SELECT
--    Target roles: authenticated
--    Policy definition: (bucket_id = 'attachments'::text)
--
--    Policy Name: Allow all authenticated deletes
--    Allowed operation: DELETE
--    Target roles: authenticated
--    Policy definition: (bucket_id = 'attachments'::text)
--
--    Policy Name: Allow public reads
--    Allowed operation: SELECT
--    Target roles: anon
--    Policy definition: (bucket_id = 'attachments'::text)
