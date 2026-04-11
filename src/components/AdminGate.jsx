import { useState } from 'react';
import { Shield, Lock } from 'lucide-react';

const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN || '1234';

export default function AdminGate({ children }) {
  const [unlocked, setUnlocked] = useState(() => {
    return sessionStorage.getItem('admin_unlocked') === 'true';
  });
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (pin === ADMIN_PIN) {
      sessionStorage.setItem('admin_unlocked', 'true');
      setUnlocked(true);
      setError(false);
    } else {
      setError(true);
      setPin('');
    }
  }

  if (unlocked) return children;

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-sm text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-indigo-600/20 flex items-center justify-center mx-auto">
          <Lock className="text-indigo-400" size={28} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Admin Access</h2>
          <p className="text-gray-500 text-sm">أدخل رمز الدخول</p>
        </div>
        <input
          type="password"
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(false); }}
          placeholder="••••"
          autoFocus
          className={`w-full bg-gray-800 border rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] text-white placeholder-gray-600 focus:outline-none ${
            error ? 'border-red-500 shake' : 'border-gray-700 focus:border-indigo-500'
          }`}
        />
        {error && <p className="text-red-400 text-sm">رمز خاطئ</p>}
        <button
          type="submit"
          className="w-full bg-indigo-600 hover:bg-indigo-700 px-4 py-3 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
        >
          <Shield size={16} />
          دخول
        </button>
      </form>
    </div>
  );
}
