// src/app/curtain/page.tsx
"use client";
import CurtainScene from "./CurtainScene";

export default function CurtainPage() {
  return (
    <>
      {/* your real page content sits underneath; add enough height to scroll */}
      <main className="min-h-[200vh] bg-white">
        <section className="p-8">
          <h1 className="text-3xl font-bold">Your Page</h1>
          <p className="mt-2 text-gray-600">
            Scroll down to open the curtains.
          </p>
        </section>
      </main>

      {/* curtain overlay */}
      <CurtainScene />
    </>
  );
}
