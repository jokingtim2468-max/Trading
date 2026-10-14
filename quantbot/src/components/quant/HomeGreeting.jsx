import LogoMark from './LogoMark';
import MarketDesk from './MarketDesk';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeGreeting({ name }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-8 px-4 md:px-6 py-6 overflow-y-auto">
      <div className="flex items-center gap-4">
        <LogoMark className="w-10 h-10" />
        <h1 className="font-heading font-light text-4xl md:text-5xl text-foreground/90">
          {greeting()}, {name}
        </h1>
      </div>
      <MarketDesk />
    </div>
  );
}