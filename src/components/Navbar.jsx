import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Swords, LogOut } from 'lucide-react';

export default function Navbar() {
  const { pathname } = useLocation();

  function handleLogout() {
    sessionStorage.removeItem('admin_unlocked');
    window.location.href = '/';
  }

  return (
    <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        <Link to="/admin" className="flex items-center gap-2 text-indigo-400 font-bold text-lg">
          <Swords size={22} />
          <span>Round 2 Arena</span>
          <span className="text-xs bg-indigo-600/30 text-indigo-300 px-2 py-0.5 rounded-full ml-1">ADMIN</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            to="/admin"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              pathname === '/admin'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            <LayoutDashboard size={16} />
            Dashboard
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors"
          >
            <LogOut size={16} />
            خروج
          </button>
        </div>
      </div>
    </nav>
  );
}
