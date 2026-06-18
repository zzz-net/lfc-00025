import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "@/pages/Home";
import SandboxList from "@/pages/SandboxList";
import SandboxDetail from "@/pages/SandboxDetail";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sandbox" element={<SandboxList />} />
        <Route path="/sandbox/:id" element={<SandboxDetail />} />
        <Route path="/other" element={<div className="text-center text-xl">Other Page - Coming Soon</div>} />
      </Routes>
    </Router>
  );
}
