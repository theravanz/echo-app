import { createClient } from "@supabase/supabase-js";

// Оператор "!" гарантирует, что если ключей нет при сборке — билд упадет,
// и вы сразу поймете, что забыли добавить .env файл.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);