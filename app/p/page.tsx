// Статичный entry для роута /p?u=<username>.
// Используем query-параметр вместо динамического сегмента [username],
// т.к. output: 'export' (статическая сборка для Tauri) не поддерживает
// динамические роуты в рантайме.
import PublicProfilePage from './PublicProfilePage';

export default function Page() {
  return <PublicProfilePage />;
}
