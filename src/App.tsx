import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { ThemeProvider } from "./hooks/useTheme";
import HomePage from "./pages/HomePage";
import ProblemPage from "./pages/ProblemPage";
import AttemptPage from "./pages/AttemptPage";
import FeedbackPage from "./pages/FeedbackPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/problem/:problemId" element={<ProblemPage />} />
            <Route path="/attempt/:attemptId" element={<AttemptPage />} />
            <Route path="/feedback/:attemptId" element={<FeedbackPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<HomePage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
