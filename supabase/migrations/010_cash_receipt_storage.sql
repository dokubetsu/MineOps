-- Migration 010: Cash receipt image storage
-- Adds cash-receipts storage bucket and receipt_url column to cash_entries

-- 1. Add receipt_url column to cash_entries
ALTER TABLE public.cash_entries
  ADD COLUMN IF NOT EXISTS receipt_url text;

-- 2. Create private cash-receipts storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('cash-receipts', 'cash-receipts', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- 3. Storage RLS policies for cash-receipts bucket
DROP POLICY IF EXISTS "Cash receipts read access" ON storage.objects;
DROP POLICY IF EXISTS "Cash receipts write access" ON storage.objects;
DROP POLICY IF EXISTS "Cash receipts delete access" ON storage.objects;

-- Authenticated users can read receipt images
CREATE POLICY "Cash receipts read access" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cash-receipts');

-- Admins and site managers can upload receipt images
CREATE POLICY "Cash receipts write access" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cash-receipts'
    AND get_user_role() IN ('admin', 'site_manager')
  );

-- Admins and site managers can delete receipt images
CREATE POLICY "Cash receipts delete access" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'cash-receipts'
    AND get_user_role() IN ('admin', 'site_manager')
  );
