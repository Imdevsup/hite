/**
 * Marketing route group layout. Plain pass-through: the marketing pages (compare, how-to) render
 * their own nav/footer chrome via shared components, and inherit the global <html>/<body> + fonts
 * from app/layout.tsx. Kept as a server component with no client JS so these GEO pages stay
 * LCP-cheap and fully crawlable.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
