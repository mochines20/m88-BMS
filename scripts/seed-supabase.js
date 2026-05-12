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
const fiscalYear = new Date().getFullYear();

const departments = [
  { name: 'IT Department', annual_budget: 500000.0, fiscal_year: fiscalYear },
  { name: 'Purchasing Department', annual_budget: 400000.0, fiscal_year: fiscalYear },
  { name: 'Planning Department', annual_budget: 350000.0, fiscal_year: fiscalYear },
  { name: 'Logistics Department', annual_budget: 450000.0, fiscal_year: fiscalYear },
  { name: 'HR Department', annual_budget: 200000.0, fiscal_year: fiscalYear },
  { name: 'Finance Department', annual_budget: 300000.0, fiscal_year: fiscalYear },
  { name: 'Admin Department', annual_budget: 250000.0, fiscal_year: fiscalYear },
];

const users = [
  {
    name: 'John Employee',
    email: 'john.employee@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'employee',
    department_name: 'IT Department',
  },
  {
    name: 'Jane Supervisor',
    email: 'jane.supervisor@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'supervisor',
    department_name: 'IT Department',
  },
  {
    name: 'Bob Accounting',
    email: 'bob.accounting@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'accounting',
    department_name: 'Finance Department',
  },
  {
    name: 'Alice Admin',
    email: 'alice.admin@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'admin',
    department_name: 'Admin Department',
  },
  {
    name: 'Management Executive',
    email: 'management@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'management',
    department_name: null,
  },
  {
    name: 'Sarah Super Admin',
    email: 'sarah.superadmin@madison88.com',
    password_hash: '$2a$10$W8IVGUIhe6SpGriIdUUfnutCGX9uSRe9fcn5TeN9tG0l3HQULh6Wu',
    role: 'super_admin',
    department_name: null,
  },
];

const budgetCategories = [
  { category_code: 'IT001', category_name: 'IT Equipment', budget_amount: 100000.00 },
  { category_code: 'IT002', category_name: 'Software Licenses', budget_amount: 50000.00 },
  { category_code: 'IT003', category_name: 'IT Services', budget_amount: 30000.00 },
  { category_code: 'PUR001', category_name: 'Office Supplies', budget_amount: 50000.00 },
  { category_code: 'PUR002', category_name: 'Equipment', budget_amount: 150000.00 },
  { category_code: 'PUR003', category_name: 'Services', budget_amount: 50000.00 },
  { category_code: 'PLAN001', category_name: 'Training', budget_amount: 50000.00 },
  { category_code: 'PLAN002', category_name: 'Events', budget_amount: 100000.00 },
  { category_code: 'LOG001', category_name: 'Transportation', budget_amount: 200000.00 },
  { category_code: 'LOG002', category_name: 'Logistics Services', budget_amount: 100000.00 },
  { category_code: 'HR001', category_name: 'Employee Benefits', budget_amount: 100000.00 },
  { category_code: 'HR002', category_name: 'Training & Development', budget_amount: 50000.00 },
  { category_code: 'FIN001', category_name: 'Accounting Software', budget_amount: 50000.00 },
  { category_code: 'FIN002', category_name: 'Audit Services', budget_amount: 100000.00 },
  { category_code: 'ADM001', category_name: 'Office Maintenance', budget_amount: 100000.00 },
  { category_code: 'ADM002', category_name: 'Administrative Supplies', budget_amount: 50000.00 },
];

async function main() {
  console.log('Seeding Supabase using service role key...');

  const { data: existingDepartments, error: fetchDeptError } = await supabase
    .from('departments')
    .select('id,name,fiscal_year');

  if (fetchDeptError && fetchDeptError.code !== '42P01') {
    console.error('Failed to read departments:', fetchDeptError);
    process.exit(1);
  }

  if (fetchDeptError && fetchDeptError.code === '42P01') {
    console.error('\nERROR: Database schema is missing.');
    console.error('Run docs/schema.sql in Supabase first, then rerun this script.');
    process.exit(1);
  }

  const existingKeys = new Set(existingDepartments.map((row) => `${row.name}::${row.fiscal_year}`));
  const missingDepartments = departments.filter((row) => !existingKeys.has(`${row.name}::${row.fiscal_year}`));

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

  const { data: allDepartments } = await supabase.from('departments').select('id,name,fiscal_year');
  const departmentIdByName = Object.fromEntries(allDepartments.map((row) => [`${row.name}::${row.fiscal_year}`, row.id]));

  const usersToInsert = users.map((user) => ({
    name: user.name,
    email: user.email,
    password_hash: user.password_hash,
    role: user.role,
    department_id: user.department_name ? departmentIdByName[`${user.department_name}::${fiscalYear}`] : null,
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

  // Seed budget categories
  const { data: existingCategories, error: fetchCatError } = await supabase
    .from('budget_categories')
    .select('id,department_id,fiscal_year,category_code');

  if (fetchCatError && fetchCatError.code !== '42P01') {
    console.error('Failed to read budget_categories:', fetchCatError);
    process.exit(1);
  }

  if (!fetchCatError || fetchCatError.code !== '42P01') {
    const existingKeys = new Set(existingCategories.map((row) => `${row.department_id}::${row.fiscal_year}::${row.category_code}`));
    
    const categoriesToInsert = [];
    for (const dept of allDepartments) {
      for (const cat of budgetCategories) {
        const key = `${dept.id}::${fiscalYear}::${cat.category_code}`;
        if (!existingKeys.has(key)) {
          categoriesToInsert.push({
            department_id: dept.id,
            fiscal_year: fiscalYear,
            category_code: cat.category_code,
            category_name: cat.category_name,
            budget_amount: cat.budget_amount,
          });
        }
      }
    }

    if (categoriesToInsert.length > 0) {
      const { error: insertCatError } = await supabase.from('budget_categories').insert(categoriesToInsert);
      if (insertCatError) {
        console.error('Failed to insert budget categories:', insertCatError);
        process.exit(1);
      }
      console.log(`Inserted ${categoriesToInsert.length} budget categories.`);
    } else {
      console.log('Budget categories already exist.');
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
