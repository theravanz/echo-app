// components/MainApp.tsx
'use client';

export default function MainApp() {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-zinc-900 text-white">
      <h1 className="text-2xl font-bold">
        Добро пожаловать в Echo! 
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        (Здесь будет твой основной интерфейс)
      </p>
    </div>
  );
}