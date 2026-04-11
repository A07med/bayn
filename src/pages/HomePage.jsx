import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { subscribeMatches } from '../services/supabaseService';
import { Gamepad2, Swords, ChevronRight, Monitor, Shield } from 'lucide-react';

export default function HomePage() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeMatches((data) => {
      setMatches(data);
      setLoading(false);
    });
    return unsub;
  }, []);

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

          {loading ? (
            <div className="text-gray-600 text-sm py-4">جاري التحميل...</div>
          ) : matches.length === 0 ? (
            <div className="text-gray-600 text-sm py-4">لا توجد مباريات حالياً</div>
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
