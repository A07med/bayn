import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { subscribeMatches, getMatches } from '../services/supabaseService';
import { isSupabaseConfigured } from '../supabase';
import { Gamepad2, Swords, ChevronRight, Monitor, Shield, AlertTriangle } from 'lucide-react';

export default function HomePage() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      setFetchError(null);
      return undefined;
    }

    let cancelled = false;
    setFetchError(null);
    getMatches()
      .then((data) => {
        if (!cancelled) {
          setMatches(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) {
          setFetchError(err.message || String(err));
          setLoading(false);
        }
      });

    const unsub = subscribeMatches((data) => {
      if (!cancelled) setMatches(data);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [configured]);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="max-w-lg w-full text-center space-y-8">
        {/* Logo */}
        <div className="space-y-3">
          <Swords className="text-indigo-400 mx-auto" size={48} />
          <h1 className="text-4xl md:text-5xl font-black text-white">
            Round 2 Arena
          </h1>
          <p className="text-gray-500 text-lg">اختر مباراتك</p>
        </div>

        {/* Match List */}
        <div className="bg-gray-900 border-2 border-gray-800 rounded-2xl p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-green-600/20 flex items-center justify-center mx-auto mb-4">
            <Gamepad2 className="text-green-400" size={28} />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">شاشة المتسابقين</h2>
          <p className="text-gray-500 text-sm mb-5">اختر مباراتك لعرض الأسئلة</p>

          {!configured ? (
            <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-4 text-left text-sm space-y-2">
              <div className="flex items-center gap-2 text-amber-200 font-bold">
                <AlertTriangle size={18} />
                Supabase not configured (deployment)
              </div>
              <p className="text-amber-100/90">
                Add <code className="bg-black/30 px-1 rounded">VITE_SUPABASE_URL</code> and{' '}
                <code className="bg-black/30 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> in your host
                (Vercel / Netlify / GitHub Actions) Environment Variables, then trigger a new build.
              </p>
              <p className="text-gray-500 text-xs">
                Local: copy <code className="bg-black/30 px-1">.env.example</code> to{' '}
                <code className="bg-black/30 px-1">.env</code> — never commit real keys.
              </p>
            </div>
          ) : loading ? (
            <div className="text-gray-600 text-sm py-4">جاري التحميل...</div>
          ) : fetchError ? (
            <div className="rounded-xl border border-red-800/60 bg-red-950/30 px-4 py-4 text-sm text-red-200 space-y-2">
              <div className="flex items-center gap-2 font-bold">
                <AlertTriangle size={18} />
                Could not load matches
              </div>
              <p className="text-red-100/80 break-words">{fetchError}</p>
              <p className="text-gray-500 text-xs">
                Check Supabase URL/key, RLS policies, and that the <code className="bg-black/30 px-1">matches</code>{' '}
                table exists.
              </p>
            </div>
          ) : matches.length === 0 ? (
            <div className="text-gray-600 text-sm py-4 space-y-2">
              <p>لا توجد مباريات حالياً</p>
              <p className="text-gray-500 text-xs">
                Open <span className="text-indigo-400">Admin</span> below, create teams and matches, then refresh.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {matches.map((m) => (
                <Link
                  key={m.id}
                  to={`/play/${m.id}`}
                  className="flex items-center justify-between bg-gray-800 hover:bg-gray-700 rounded-xl px-4 py-3 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs bg-gray-700 group-hover:bg-gray-600 px-2 py-0.5 rounded-full text-gray-400">
                      #{m.matchNumber}
                    </span>
                    <span className="text-sm text-white font-medium">
                      {m.teamA?.name} <span className="text-gray-500">vs</span> {m.teamB?.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      m.status === 'running' ? 'bg-green-900 text-green-400 animate-pulse' :
                      m.status === 'completed' ? 'bg-blue-900 text-blue-400' :
                      'bg-gray-700 text-gray-400'
                    }`}>
                      {m.status === 'running' ? 'جارية' :
                       m.status === 'completed' ? 'انتهت' :
                       m.status === 'paused' ? 'متوقفة' : 'قادمة'}
                    </span>
                    <ChevronRight size={14} className="text-gray-500 group-hover:text-white transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-sm">
          <Link
            to="/live"
            className="inline-flex items-center gap-2 text-gray-500 hover:text-indigo-400 transition-colors"
          >
            <Monitor size={16} />
            <span>الشاشة الرئيسية (عرض مباشر)</span>
          </Link>
          <Link
            to="/admin"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-amber-400/90 transition-colors"
          >
            <Shield size={16} />
            <span>لوحة المشرف / Admin</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
