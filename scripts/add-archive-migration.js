const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envFiles = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), 'backend', '.env')];
const env = {};

envFiles.forEach((filePath) => {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, 'utf8');
  contents.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...rest] = trimmed.split('=');
    env[key.trim()] = rest.join('=').trim();
  });
});

const SUPABASE_URL = env.SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('\nERROR: Missing Supabase configuration.');
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE in root .env or backend/.env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

async function runMigration() {
  console.log('Running archive functionality migration...');

  try {
    // Check if archived column exists
    const { data: columns, error: columnsError } = await supabase
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_name', 'expense_requests')
      .eq('column_name', 'archived');

    if (columnsError) {
      console.error('Error checking columns:', columnsError);
      return;
    }

    if (columns && columns.length > 0) {
      console.log('Archived column already exists. Skipping migration.');
      return;
    }

    // Add archived column using raw SQL via Supabase
    // Since exec_sql doesn't exist, we'll try a different approach
    console.log('Please run the following SQL in your Supabase SQL editor:');
    console.log(`
-- Add archived field to expense_requests table
ALTER TABLE expense_requests
ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;

-- Add index for archived requests
CREATE INDEX IF NOT EXISTS idx_expense_requests_archived
ON expense_requests (archived);

-- Add index for archived and status combination
CREATE INDEX IF NOT EXISTS idx_expense_requests_archived_status
ON expense_requests (archived, status);
    `);

  } catch (error) {
    console.error('Migration check failed:', error);
  }
}

runMigration();