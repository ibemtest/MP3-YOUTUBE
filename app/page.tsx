import { Mp3Converter } from '@/components/Mp3Converter';

export default function HomePage() {
  return (
    <main className="min-h-screen w-full bg-white text-neutral-900 flex flex-col justify-center items-center px-4 py-12 sm:py-16 selection:bg-neutral-200">
      <Mp3Converter />
    </main>
  );
}
