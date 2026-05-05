// Insert Manager directly to Supabase
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const supabaseUrl = 'https://hjjpqwzmrnjquneuppeb.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwanBxd3ptcm5qcXVuZXVwcGViIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTY4NDIwMDQwMCwiZXhwIjoyMDAwMDAwMDAwfQ.s9S8fI1h4O6z5J6Q1L6j8o0v2tQ3bF8gH0jK1l2m3n'; // Try service role key

const supabase = createClient(supabaseUrl, supabaseKey);

async function insertManager() {
  try {
    console.log('🔄 Creating Manager in Supabase...\n');

    // First get IT Department ID
    const { data: dept, error: deptError } = await supabase
      .from('departments')
      .select('id, name')
      .ilike('name', '%IT%')
      .limit(1)
      .single();

    if (deptError || !dept) {
      console.error('❌ Could not find IT Department:', deptError);
      return;
    }

    console.log('✅ Found Department:', dept.name, '(ID:', dept.id + ')');

    // Check if user exists
    const { data: existing, error: checkError } = await supabase
      .from('users')
      .select('id, email, role')
      .eq('email', 'manager.test@madison88.com')
      .single();

    if (existing) {
      console.log('⚠️ User already exists!');
      console.log('   Current role:', existing.role);
      
      // Update to manager if needed
      if (existing.role !== 'manager') {
        const { data: updated, error: updateError } = await supabase
          .from('users')
          .update({ role: 'manager', updated_at: new Date() })
          .eq('id', existing.id)
          .select()
          .single();
        
        if (updateError) {
          console.error('❌ Error updating role:', updateError);
        } else {
          console.log('✅ Role updated to "manager"!');
        }
      }
      
      console.log('\n═══════════════════════════════════════');
      console.log('📧 Email: manager.test@madison88.com');
      console.log('🔑 Password: Manager123!');
      console.log('🎭 Role: manager');
      console.log('═══════════════════════════════════════');
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash('Manager123!', 10);

    // Insert manager
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        name: 'Test Manager',
        email: 'manager.test@madison88.com',
        password_hash: passwordHash,
        role: 'manager',
        department_id: dept.id,
        created_at: new Date(),
        updated_at: new Date()
      })
      .select()
      .single();

    if (insertError) {
      console.error('❌ Insert error:', insertError);
      return;
    }

    console.log('✅ Manager created successfully!');
    console.log('\n═══════════════════════════════════════');
    console.log('📧 Email: manager.test@madison88.com');
    console.log('🔑 Password: Manager123!');
    console.log('🎭 Role: manager');
    console.log('🏢 Department:', dept.name);
    console.log('🆔 User ID:', newUser.id);
    console.log('═══════════════════════════════════════');
    console.log('\n📝 Now login at http://localhost:5173/');

  } catch (err) {
    console.error('❌ Script error:', err);
  }
}

insertManager();
