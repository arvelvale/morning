import Nav from './components/Nav';
import Hero from './components/Hero';
import MeetSection from './components/MeetSection';
import DumpSection from './components/DumpSection';
import MemorySection from './components/MemorySection';
import DeskSection from './components/DeskSection';
import TheaterSection from './components/TheaterSection';
import DownloadSection from './components/DownloadSection';
import Footer from './components/Footer';
import { useReveal } from './hooks/useReveal';

export default function App() {
  useReveal();
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <MeetSection />
        <DumpSection />
        <MemorySection />
        <DeskSection />
        <TheaterSection />
        <DownloadSection />
      </main>
      <Footer />
    </>
  );
}
