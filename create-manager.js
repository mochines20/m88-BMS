// Script to create a test Manager account
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

// Supabase setup
const supabaseUrl = 'https://hjjpqwzmrnjquneuppeb.supabase.co';
const supabaseKey = 'sb_publishable_4OT_XzItsdRNe8Jtm43nGg_-gT8fLru';
const supabase = createClient(supabaseUrl, supabaseKey);

async function createManagerAccount() {
  try {
    // Manager user data
    const managerData = {
      name: 'Test Manager',
      email: 'manager.test@madison88.com',
      password: 'Manager123!',
      role: 'manager',
      department_id: null // Will be assigned after signup
    };

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(managerData.password, saltRounds);

    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', managerData.email.toLowerCase())
      .maybeSingle();

    if (existingUser) {
      console.log('⚠️ Manager account already exists!');
      console.log('📧 Email:', managerData.email);
      console.log('🔑 Password:', managerData.password);
      return;
    }

    // Find IT Department for assignment
    const { data: itDept, error: deptError } = await supabase
      .from('departments')
      .select('id, name')
      .ilike('name', '%IT%')
      .limit(1)
      .maybeSingle();

    let departmentId = null;
    if (itDept) {
      departmentId = itDept.id;
      console.log('✅ Found IT Department:', itDept.name);
    } else {
      console.log('⚠️ No IT Department found, creating without department...');
    }

    // Create the user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        name: managerData.name,
        email: managerData.email.toLowerCase(),
        password_hash: passwordHash,
        role: managerData.role,
        department_id: departmentId,
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();

    if (createError) {
      console.error('❌ Error creating manager:', createError);
      return;
    }

    console.log('\n✅ Manager Account Created Successfully!');
    console.log('═══════════════════════════════════════');
    console.log('📧 Email:', managerData.email);
    console.log('🔑 Password:', managerData.password);
    console.log('🎭 Role:', managerData.role);
    console.log('🏢 Department:', itDept?.name || 'None');
    console.log('🆔 User ID:', newUser.id);
    console.log('═══════════════════════════════════════');
    console.log('\n📝 Login Instructions:');
    console.log('1. Go to http://localhost:5173/');
    console.log('2. Enter email: manager.test@madison88.com');
    console.log('3. Enter password: Manager123!');
    console.log('4. Click Sign In');
    console.log('\n🔄 Expected Behavior:');
    console.log('- Manager will see Employee Workspace');
    console.log('- Can submit requests (goes to Supervisor first)');
    console.log('- Cannot approve requests (needs Supervisor role for that)');

  } catch (error) {
    console.error('❌ Script error:', error);
  }
}

// Run the script
createManagerAccount();
