# Backend API: Password Verification for Digital Signatures

## Endpoint: POST /api/auth/verify-password

Verifies user password and generates a digital signature for non-repudiable audit logging.

### Request

```http
POST /api/auth/verify-password
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "password": "user_password_here"
}
```

### Response (Success)

```json
{
  "valid": true,
  "signature": "a1b2c3d4e5f6...",  // SHA-256 hash of action + timestamp + user_id
  "timestamp": "2025-05-06T08:30:00Z",
  "user": {
    "id": "uuid",
    "name": "Juan Dela Cruz",
    "role": "supervisor"
  }
}
```

### Response (Invalid Password)

```json
{
  "valid": false,
  "error": "Invalid password"
}
```

### Backend Implementation

```typescript
// backend/src/routes/auth.ts
import crypto from 'crypto';
import bcrypt from 'bcrypt';

router.post('/verify-password', authenticate, async (req, res) => {
  const { password } = req.body;
  const userId = req.user.id;
  
  // Fetch user with password hash
  const { data: user, error } = await supabase
    .from('users')
    .select('id, password_hash, name, role')
    .eq('id', userId)
    .single();
  
  if (error || !user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  // Verify password
  const valid = await bcrypt.compare(password, user.password_hash);
  
  if (!valid) {
    // Log failed attempt
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'password_verification_failed',
      entity_type: 'auth',
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      created_at: new Date()
    });
    
    return res.status(401).json({ valid: false, error: 'Invalid password' });
  }
  
  // Generate digital signature
  const timestamp = new Date().toISOString();
  const signatureData = `${userId}:${timestamp}:${crypto.randomBytes(16).toString('hex')}`;
  const signature = crypto.createHash('sha256').update(signatureData).digest('hex');
  
  res.json({
    valid: true,
    signature,
    timestamp,
    user: {
      id: user.id,
      name: user.name,
      role: user.role
    }
  });
});
```

## Updated Audit Log Schema

Add these columns to `audit_logs` table:

```sql
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS digital_signature TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;
```

## Store Signature in Audit Log

When approving/rejecting/returning with signature:

```typescript
// In request routes
await supabase.from('audit_logs').insert({
  request_id: requestId,
  user_id: req.user.id,
  action: 'approved', // or 'rejected', 'returned', 'released'
  entity_type: 'request',
  field_name: 'status',
  old_value: oldStatus,
  new_value: newStatus,
  note: note || null,
  digital_signature: signature,  // From password verify
  ip_address: req.ip,
  user_agent: req.headers['user-agent'],
  device_fingerprint: generateDeviceFingerprint(req),
  created_at: new Date()
});
```

## Device Fingerprint

```typescript
function generateDeviceFingerprint(req: Request): string {
  const data = `${req.headers['user-agent']}:${req.ip}:${req.headers['accept-language']}`;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}
```
