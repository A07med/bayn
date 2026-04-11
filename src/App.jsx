import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import AdminGate from './components/AdminGate';
import HomePage from './pages/HomePage';
import AdminPage from './pages/AdminPage';
import MatchPage from './pages/MatchPage';
import PlayerMatchPage from './pages/PlayerMatchPage';
import LivePage from './pages/LivePage';
import ResultsPage from './pages/ResultsPage';

function Layout() {
  const { pathname } = useLocation();
  const isAdmin = pathname.startsWith('/admin');

  return (
    <>
      {isAdmin && <Navbar />}
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin" element={<AdminGate><AdminPage /></AdminGate>} />
        <Route path="/admin/match/:matchId" element={<AdminGate><MatchPage /></AdminGate>} />
        <Route path="/play/:matchId" element={<PlayerMatchPage />} />
        <Route path="/live" element={<LivePage />} />
        <Route path="/results" element={<ResultsPage />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}
