// Helper único para invocar Edge Functions: desenvuelve el error real del body
// (FunctionsHttpError esconde el detalle en context) — antes duplicado en Admin y Chat.
import { supabase } from './supabaseClient'

export async function invokeFn(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    const detail = await error.context?.json?.().then((j) => j.error).catch(() => null)
    throw new Error(detail || error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}
