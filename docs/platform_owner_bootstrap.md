# Platform owner bootstrap

Platform owners (`platform_owner`) manage all mining organizations: create tenants, set first admin passwords, and enable/disable modules. They are **not** tenant admins and do not use `/dashboard` ops screens.

## One-time setup (you as developer)

### 1. Apply migrations

```bash
supabase db push
# includes 036_platform_owner_and_org_features.sql
```

### 2. Create the Auth user

In **Supabase Dashboard → Authentication → Users → Add user**:

- Email: your operator email (e.g. `you@company.com`)
- Password: strong temporary password
- Auto-confirm email: **yes**

Copy the user’s **UUID**.

### 3. Grant platform_owner

In **SQL Editor**:

```sql
INSERT INTO public.platform_roles (user_id, role)
VALUES ('PASTE-AUTH-USER-UUID-HERE', 'platform_owner')
ON CONFLICT (user_id) DO NOTHING;
```

### 4. Sign in

Open the app login page with that email/password.

You are redirected to **`/platform`** (not `/dashboard`).

### 5. Provision a mining org

On **Organizations → New organization**:

1. Company name  
2. Admin email + temporary password (you choose)  
3. Toggle modules  
4. Create  

Share the admin email/password with the customer out of band. They sign in on the same app URL and land on the tenant dashboard. They create site managers and employees under **User Access**.

### 6. Optional: more platform owners

Create another Auth user, then:

```sql
INSERT INTO public.platform_roles (user_id, role)
VALUES ('OTHER-USER-UUID', 'platform_owner');
```

There is no public self-signup for platform owners.

## Public registration

- `POST /api/auth/register-tenant` always returns **403**  
- `/register` explains that orgs are operator-provisioned  

## Feature flags

Stored in `organization_features`. Platform console toggles them; tenant nav hides disabled modules.

Default for new orgs: all modules **on**.
