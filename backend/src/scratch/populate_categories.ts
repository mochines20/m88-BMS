
import { supabase } from '../utils/supabase';
import { OFFICIAL_EXPENSE_LIST } from '../utils/expenseValidator';
import { getLatestConfiguredFiscalYear } from '../utils/fiscal';

async function populateCategories() {
  console.log('Starting category population (Revised)...');

  // 1. Get all departments
  const { data: departments, error: deptError } = await supabase.from('departments').select('*');
  if (deptError || !departments) {
    console.error('Error fetching departments:', deptError);
    return;
  }

  const fiscalYear = await getLatestConfiguredFiscalYear(supabase);
  console.log(`Target Fiscal Year: ${fiscalYear}`);

  // 2. Map unique categories to their codes
  const categoryToCode = new Map<string, string>();
  OFFICIAL_EXPENSE_LIST.forEach(item => {
    const mainCode = item.code.split('.')[0];
    categoryToCode.set(item.category, mainCode);
  });

  // 3. Map items to departments
  const deptToCategories = new Map<string, Set<string>>();
  
  OFFICIAL_EXPENSE_LIST.forEach(item => {
    const catName = item.category;
    const allowedDepts = Array.isArray(item.dept) ? item.dept : [item.dept];
    
    if (allowedDepts.includes('All Dept')) {
      departments.forEach(dept => {
        if (!deptToCategories.has(dept.id)) deptToCategories.set(dept.id, new Set());
        deptToCategories.get(dept.id)?.add(catName);
      });
    } else {
      allowedDepts.forEach(allowedDeptName => {
        const matchingDept = departments.find(d => 
          d.name.toLowerCase().includes(allowedDeptName.toLowerCase()) || 
          allowedDeptName.toLowerCase().includes(d.name.toLowerCase())
        );
        if (matchingDept) {
          if (!deptToCategories.has(matchingDept.id)) deptToCategories.set(matchingDept.id, new Set());
          deptToCategories.get(matchingDept.id)?.add(catName);
        }
      });
    }
  });

  // 4. Process each department
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const [deptId, categories] of deptToCategories.entries()) {
    const deptName = departments.find(d => d.id === deptId)?.name;
    console.log(`Processing ${deptName}...`);

    // Get all existing categories for this dept/year to avoid duplicate queries
    const { data: existingCats } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('department_id', deptId)
      .eq('fiscal_year', fiscalYear);

    const existingByName = new Map((existingCats || []).map(c => [c.category_name, c]));
    const existingByCode = new Map((existingCats || []).map(c => [c.category_code, c]));

    for (const catName of categories) {
      const catCode = categoryToCode.get(catName) || 'MISC';

      const byName = existingByName.get(catName);
      const byCode = existingByCode.get(catCode);

      if (byName) {
        // Name matches, maybe check code?
        if (byName.category_code !== catCode) {
           // Should we update the code? Maybe safer to leave it if it has transactions.
           // For now, let's skip.
        }
        skippedCount++;
        continue;
      }

      if (byCode) {
        // Code matches but name is different. Update name to official one.
        console.log(`  Updating category name: "${byCode.category_name}" -> "${catName}" (Code: ${catCode})`);
        const { error: updateError } = await supabase
          .from('budget_categories')
          .update({ category_name: catName, updated_at: new Date() })
          .eq('id', byCode.id);
        
        if (updateError) {
          console.error(`  Error updating ${catCode}:`, updateError);
        } else {
          updatedCount++;
        }
        continue;
      }

      // Neither name nor code exists, insert new
      const { error: insertError } = await supabase.from('budget_categories').insert({
        department_id: deptId,
        fiscal_year: fiscalYear,
        category_code: catCode,
        category_name: catName,
        budget_amount: 0,
        remaining_amount: 0,
        used_amount: 0,
        committed_amount: 0,
        created_at: new Date(),
        updated_at: new Date()
      });

      if (insertError) {
        console.error(`  Error inserting ${catName}:`, insertError);
      } else {
        createdCount++;
      }
    }
  }

  console.log(`Finished! Created: ${createdCount}, Updated: ${updatedCount}, Skipped: ${skippedCount}`);
}

populateCategories();
