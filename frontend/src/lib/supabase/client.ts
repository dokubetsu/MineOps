import { createBrowserClient } from '@supabase/ssr'
import { Database } from './database.types'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  // Guard only in client-side runtime to allow build-time prerendering to pass
  if (typeof window !== 'undefined' && (!url || !key)) {
    throw new Error('Supabase configuration error: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables')
  } else if (!url || !key) {
    console.warn('Warning: Supabase environment variables are missing during SSR/build-time prerender. Returning placeholder browser client.')
  }

  return createBrowserClient<Database>(
    url || 'http://127.0.0.1:0',
    key || 'placeholder-key'
  )
}
