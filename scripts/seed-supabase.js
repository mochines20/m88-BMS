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
  console.error('Example: SUPABASE_SERVICE_ROLE=your_service_role_key');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

const departments = [
  { name: 'm88IT', annual_budget: 500000.0, fiscal_year: 2024 },
  { name: 'm88Purchasing', annual_budget: 400000.0, fiscal_year: 2024 },
  { name: 'm88Planning', annual_budget: 350000.0, fiscal_year: 2024 },
  { name: 'm88logistics', annual_budget: 450000.0, fiscal_year: 2024 },
  { name: 'm88HR', annual_budget: 200000.0, fiscal_year: 2024 },
  { name: 'm88accounting', annual_budget: 300000.0, fiscal_year: 2024 },
];

const users = [
  {
    name: 'John Employee',
    email: 'john.employee@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'employee',
    department_name: 'm88IT',
  },
  {
    name: 'Jane Supervisor',
    email: 'jane.supervisor@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'supervisor',
    department_name: 'm88IT',
  },
  {
    name: 'Bob Accounting',
    email: 'bob.accounting@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'accounting',
    department_name: 'm88accounting',
  },
  {
    name: 'Alice Admin',
    email: 'alice.admin@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'admin',
    department_name: 'm88accounting',
  },
];

async function main() {
  console.log('Seeding Supabase using service role key...');

  const { data: existingDepartments, error: fetchDeptError } = await supabase
    .from('departments')
    .select('id,name');

  if (fetchDeptError && fetchDeptError.code !== '42P01') {
    console.error('Failed to read departments:', fetchDeptError);
    process.exit(1);
  }

  if (fetchDeptError && fetchDeptError.code === '42P01') {
    console.error('\nERROR: Database schema is missing.');
    console.error('Run docs/schema.sql in Supabase first, then rerun this script.');
    process.exit(1);
  }

  const existingNames = new Set(existingDepartments.map((row) => row.name));
  const missingDepartments = departments.filter((row) => !existingNames.has(row.name));

  if (missingDepartments.length > 0) {
    const { error: insertDeptError } = await supabase.from('departments').insert(missingDepartments);
    if (insertDeptError) {
      console.error('Failed to insert departments:', insertDeptError);
      process.exit(1);
    }
    console.log(`Inserted ${missingDepartments.length} departments.`);
  } else {
    console.log('Departments already exist.');
  }

  const { data: allDepartments } = await supabase.from('departments').select('id,name');
  const departmentIdByName = Object.fromEntries(allDepartments.map((row) => [row.name, row.id]));

  const usersToInsert = users.map((user) => ({
    name: user.name,
    email: user.email,
    password_hash: user.password_hash,
    role: user.role,
    department_id: departmentIdByName[user.department_name],
  }));

  const { data: existingUsers, error: fetchUserError } = await supabase
    .from('users')
    .select('email');

  if (fetchUserError) {
    console.error('Failed to read users:', fetchUserError);
    process.exit(1);
  }

  const existingEmails = new Set(existingUsers.map((row) => row.email));
  const missingUsers = usersToInsert.filter((user) => !existingEmails.has(user.email));

  if (missingUsers.length > 0) {
    const { error: insertUserError } = await supabase.from('users').insert(missingUsers);
    if (insertUserError) {
      console.error('Failed to insert users:', insertUserError);
      process.exit(1);
    }
    console.log(`Inserted ${missingUsers.length} users.`);
  } else {
    console.log('Sample users already exist.');
  }

  // Update password hashes for existing users
  for (const user of users) {
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: user.password_hash })
      .eq('email', user.email);
    if (updateError) {
      console.error(`Failed to update password for ${user.email}:`, updateError);
    } else {
      console.log(`Updated password hash for ${user.email}`);
    }
  }

  const { data: finalUsers } = await supabase
    .from('users')
    .select('id,name,email,role')
    .in('email', users.map((user) => user.email));

  console.log('Seed complete. Sample users:');
  console.table(finalUsers);
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
