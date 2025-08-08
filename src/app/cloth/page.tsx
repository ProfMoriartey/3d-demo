"use client";
import dynamic from "next/dynamic";

const ClothScene = dynamic(() => import("./ClothScene"), { ssr: false });

export default function ClothPage() {
  return <ClothScene />;
}
