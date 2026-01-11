import { useMemo, useRef, useState } from "react";

export function Avatar({ photoURL, name }: { photoURL?: string | null; name?: string | null }) {
  const [broken, setBroken] = useState(false);
  const handledRef = useRef(false);

  const src = useMemo(() => {
    if (!photoURL || broken) return null; // Return null to show fallback
    return photoURL; // IMPORTANT: no cache-buster, no Date.now()
  }, [photoURL, broken]);

  // If no src (broken or no photoURL), show fallback avatar
  if (!src) {
    return (
      <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
        {(name || 'U')[0].toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name ?? "User"}
      className="h-8 w-8 rounded-full"
      referrerPolicy="no-referrer"
      onError={() => {
        if (handledRef.current) return;
        handledRef.current = true;
        setBroken(true);
      }}
    />
  );
}