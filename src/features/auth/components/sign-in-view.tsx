import { SignIn as ClerkSignInForm } from '@clerk/nextjs';

/**
 * Sign-in page framing.
 *
 * ⚠️ CLERK IS UNTOUCHED FUNCTIONALLY. `<ClerkSignInForm />` renders exactly as
 * before and the routes stay `/auth/sign-in` / `/auth/sign-up`; only the surround
 * changed. `NEXT_PUBLIC_CLERK_SIGN_IN_URL` must keep pointing here or Clerk
 * redirects to `/sign-in`, which does not exist in this app.
 *
 * ── What was removed, and why ───────────────────────────────────────────────
 *   • The dashboard-starter's two-column marketing panel, its placeholder
 *     `Logo` SVG, the InteractiveGridPattern and a fake testimonial from
 *     "Random Dude". None of it is ours.
 *   • A ghost "Login" link to `/examples/authentication` — a starter route that
 *     does not exist here, so it 404'd from the sign-in page.
 *   • `initialValues={{ emailAddress: 'your_mail+clerk_test@example.com' }}`,
 *     which pre-filled every sign-in form with a Clerk test address. Harmless in
 *     a demo, confusing in an internal portal, and actively wrong the moment a
 *     real person tries to sign in.
 *   • A duplicate `export const metadata` — this is a component file, not a
 *     route, so Next never read it. The real metadata lives on the page.
 *
 * ⚠️ NO ROLE PICKER. The mockup's login screen has a demo grid for choosing a
 * persona; production assigns a role from the `person` roster (Clerk email →
 * `person_identity('portal', …)` → `person.role_id`). A picker would let anyone
 * grant themselves founder access, which is the opposite of what the role table
 * is for.
 */
export default function SignInViewPage() {
  return (
    <div className='flex min-h-screen flex-col items-center justify-center gap-8 p-6'>
      {/* Centred brand column, per the mockup's login framing. */}
      <div className='flex flex-col items-center gap-3 text-center'>
        {/* 44px block, radius 12, --sidebar-primary — the sidebar's 30px header
            tile at login scale, so the two surfaces read as one product. */}
        <div className='bg-sidebar-primary text-sidebar-primary-foreground flex size-[44px] items-center justify-center rounded-[12px] text-[16px] font-bold'>
          CC
        </div>
        <div className='space-y-1'>
          <h1 className='text-foreground text-[22px] font-bold tracking-[-0.01em]'>
            Command Center
          </h1>
          <p className='text-muted-foreground text-[13px]'>Lucky Fours · sign in</p>
        </div>
      </div>

      <ClerkSignInForm />
    </div>
  );
}
