import { useState, useEffect } from "react";
import { fetchBirthdaysToday, Birthday } from "../api";

export default function BirthdayBanner({ user }: { user: any }) {
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;
    const key = `birthdays-dismissed-${new Date().toDateString()}`;
    if (sessionStorage.getItem(key)) { setDismissed(true); return; }
    fetchBirthdaysToday()
      .then((d) => setBirthdays(d.birthdays))
      .catch(() => {});
  }, [user]);

  if (dismissed || birthdays.length === 0) return null;

  function dismiss() {
    setDismissed(true);
    sessionStorage.setItem(`birthdays-dismissed-${new Date().toDateString()}`, "1");
  }

  return (
    <div className="mx-4 mt-3 mb-0 p-3 bg-pink-50 border border-pink-200 rounded-xl flex items-start gap-3 shadow-sm">
      <span className="text-2xl mt-0.5">🎂</span>
      <div className="flex-1 min-w-0">
        {birthdays.map((b) => (
          <div key={b.personId} className="flex items-center gap-2">
            {b.thumbnailUrl && (
              <img src={b.thumbnailUrl} alt={b.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
            )}
            <p className="text-sm text-pink-900 font-medium">
              🎉 Happy Birthday, <span className="font-bold">{b.name}</span>
              {b.age ? ` — turning ${b.age} today!` : "!"}
            </p>
          </div>
        ))}
      </div>
      <button onClick={dismiss} className="text-pink-400 hover:text-pink-600 text-xl leading-none flex-shrink-0">×</button>
    </div>
  );
}
