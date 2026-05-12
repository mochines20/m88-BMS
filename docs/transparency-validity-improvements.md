# BMS Transparency & Validity Improvements

## Summary of Changes (May 6, 2026)

### 🔍 TRANSPARENCY FEATURES

#### 1. SLA Tracking (Approvals Page)
**Location:** `frontend/src/pages/Approvals.tsx`

**What it does:**
- Shows time elapsed in current approval stage
- Displays warning when SLA is breached (>24 hours)
- Visual indicator with color coding (blue = normal, red = breached)

**Visible to:**
- ✅ Supervisors (see "Supervisor" stage time)
- ✅ Accounting (see "Accounting" stage time + "On Hold" time)

**UI:**
```
⏱️ 18h              (normal - blue badge)
⏱️ 26h ⚠️ SLA      (breached - red badge)
```

---

#### 2. Complete Audit Trail (Request Tracker)
**Location:** `frontend/src/pages/RequestTracker.tsx`

**What it does:**
- Shows full chronological history of every action
- Displays who performed each action with role
- Shows timestamps, notes, and status changes
- Shows IP address and device fingerprint
- Displays digital signature verification

**Visible to:**
- ✅ Employees (own requests only)
- ✅ Supervisors (team requests)
- ✅ Accounting (all requests)

**UI:**
```
📋 Audit Trail
Complete history of all actions with digital signatures

✅ Approved                    May 6, 2025, 2:30 PM
By: Maria Santos (supervisor)
"Approved for site visit"
Signature: a3f7b2d9e8c1...
IP: 192.168.1.100 | Device: a7f3b2d9
```

---

### 🔐 VALIDITY FEATURES

#### 3. Digital Signatures (Approvals Page)
**Location:** `frontend/src/pages/Approvals.tsx`

**What it does:**
- Requires password re-entry for every approval action
- Generates non-repudiable digital signature
- Records IP, device fingerprint, timestamp
- Stores signature hash in audit log

**Applies to:**
- ✅ Approve
- ✅ Reject
- ✅ Return for revision
- ✅ Release funds

**Flow:**
1. User clicks "Approve"
2. Digital Signature Modal opens
3. User enters password
4. Backend verifies password
5. Backend generates signature hash
6. Action executed with signature stored

**UI:**
```
🔐 Digital Signature Required

To approve this request, please verify your identity 
by entering your password. This creates a non-repudiable 
digital signature.

Action: approve
Password: [**********]

[Cancel] [Confirm with Digital Signature]

Your IP, timestamp, and device fingerprint will be 
recorded for audit purposes.
```

---

#### 4. Multi-Approval Threshold (₱50,000+)
**Location:** `frontend/src/pages/Approvals.tsx`

**What it does:**
- Requests ≥ ₱50,000 require department head approval
- Supervisor cannot approve large amounts alone
- Additional check before signature modal opens

**Config:**
```typescript
const deptHeadThreshold = 50000; // ₱50K
```

**Error Message:**
```
Amount exceeds ₱50,000. Requires department head approval.
```

---

### 🗄️ BACKEND REQUIREMENTS

#### New API Endpoint
**File:** `docs/backend-api-password-verify.md`

```
POST /api/auth/verify-password
```

**Purpose:** Verify password and generate digital signature

**Request:**
```json
{
  "password": "user_password"
}
```

**Response:**
```json
{
  "valid": true,
  "signature": "sha256_hash_here",
  "timestamp": "2025-05-06T08:30:00Z"
}
```

---

#### Database Schema Updates
**Table:** `audit_logs`

Add columns:
```sql
ALTER TABLE audit_logs ADD COLUMN digital_signature TEXT;
ALTER TABLE audit_logs ADD COLUMN ip_address INET;
ALTER TABLE audit_logs ADD COLUMN user_agent TEXT;
ALTER TABLE audit_logs ADD COLUMN device_fingerprint TEXT;
```

---

### 📁 FILES MODIFIED

| File | Changes |
|------|---------|
| `Approvals.tsx` | SLA tracking, Digital Signature Modal, Multi-approval check |
| `RequestTracker.tsx` | Audit Trail viewer, fetch audit logs |
| `schema.sql` | Added `on_hold` status (from previous fix) |

---

### 🚫 EXCLUDED (Per Your Request)

| Feature | Reason |
|---------|--------|
| Budget Dashboard for Employees | You requested to hide department budget from employees |
| Team-Wide Request Visibility | You requested to exclude this |

---

### 🎯 ACCESS BY ROLE

| Feature | Employee | Supervisor | Accounting | Admin |
|---------|----------|------------|------------|-------|
| SLA Tracking | ❌ | ✅ (view) | ✅ (view) | ✅ |
| Audit Trail (own) | ✅ | - | - | - |
| Audit Trail (team) | ❌ | ✅ | ✅ | ✅ |
| Digital Signatures | ❌ | ✅ (required) | ✅ (required) | ✅ |
| Multi-Approval (₱50K+) | ❌ | ✅ (enforced) | ✅ (enforced) | ✅ |

---

### 🔒 SECURITY BENEFITS

1. **Non-Repudiation:** Digital signatures prove who performed actions
2. **Auditability:** Complete history with IP/device tracking
3. **Segregation of Duties:** Large amounts need dept head approval
4. **Accountability:** SLA tracking shows approval speed

---

### ⚙️ CONFIGURATION

```typescript
// Approvals.tsx
const SLA_HOURS = 24;                    // SLA breach threshold
const deptHeadThreshold = 50000;          // ₱50K multi-approval
```

---

## Next Steps

1. **Implement Backend:** Create `/api/auth/verify-password` endpoint
2. **Database Migration:** Add signature columns to `audit_logs`
3. **Create Audit Logs API:** `GET /api/requests/:id/audit-logs`
4. **Test:** Verify digital signature flow end-to-end

---

## Testing Checklist

- [ ] SLA indicator shows on pending requests
- [ ] SLA turns red after 24 hours
- [ ] Digital Signature Modal opens on approve/reject/return
- [ ] Invalid password shows error
- [ ] Valid password executes action
- [ ] Audit Trail loads when request selected
- [ ] Audit shows correct action history
- [ ] Digital signature hash visible in audit
- [ ] ₱50K+ request blocks without dept head approval
- [ ] Dept head approved request proceeds normally
