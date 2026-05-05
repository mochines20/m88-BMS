# Manager Test Account

## Account Details

- **Email:** manager.test@madison88.com
- **Password:** Manager123!
- **Role:** Manager
- **Name:** Test Manager

## How to Create the Account

Since the backend has intermittent issues, here's how to manually create the account:

### Option 1: Use the Signup Page
1. Go to http://localhost:5173/signup
2. Enter the following details:
   - **Name:** Test Manager
   - **Email:** manager.test@madison88.com
   - **Password:** Manager123!
   - **Department:** Select any department (e.g., IT Department)
   - **Role:** Manager (if selectable, otherwise select Employee and ask Super Admin to change it)

### Option 2: Use Admin Panel (Super Admin)
1. Login as Super Admin
2. Go to Admin Panel
3. Find "User Management" section
4. Click "Add New User"
5. Enter:
   - **Name:** Test Manager
   - **Email:** manager.test@madison88.com
   - **Password:** Manager123!
   - **Role:** Manager (now available in dropdown)
   - **Department:** IT Department
6. Click Save

## Expected Manager Behavior

### After Login, Manager Can:
- ✅ View "Manager Workspace" label
- ✅ See Employee-style dashboard
- ✅ Submit requests (routes: Manager → Supervisor → Accounting)
- ✅ View own request history
- ✅ Edit profile and department
- ✅ Resubmit returned requests

### Manager Cannot:
- ❌ Approve requests (only Supervisor/Accounting can)
- ❌ View other people's requests
- ❌ Access admin/budget management
- ❌ Release funds

## Approval Flow for Manager

```
Manager submits request
        ↓
Goes to Supervisor (pending_supervisor)
        ↓
Supervisor approves
        ↓
Goes to Accounting (pending_accounting)
        ↓
Accounting releases
        ↓
Status: released
```

## Testing Checklist

- [ ] Can login with credentials
- [ ] Sees "Manager Workspace" label
- [ ] Can submit a request
- [ ] Request appears in "My History"
- [ ] Request status shows "Waiting for Supervisor Approval"
- [ ] Supervisor receives notification
- [ ] After supervisor approval, status changes to "Waiting for Accounting Approval"
- [ ] After accounting release, status changes to "Released"

## Troubleshooting

If signup fails:
1. Make sure backend is running: `node local-dev-server.js`
2. Try using the Admin Panel instead
3. Check that the email is not already registered

## Files Modified for Manager Role

1. `local-dev-server.js` - Added manager role to endpoints
2. `Layout.tsx` - Added manager icon and label
3. `Dashboard.tsx` - Manager redirected to EmployeeHome
4. `Admin.tsx` - Manager added to role dropdown

---
**Test Account Ready!** 🎉
