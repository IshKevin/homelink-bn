// Shared visual language with the PDF templates in leases.service.ts/payments.service.ts
// (same navy/blue brand pair, same Arial stack) — one brand across every document a
// user receives, not just the emails.
const BRAND_NAVY = "#0a1628";
const BRAND_NAVY_PANEL = "#0f2038"; // one step lighter — splits the header into two zones
const BRAND_BLUE = "#2563eb";
const BRAND_BLUE_LIGHT = "#93c5fd";
const CANVAS = "#e9edf5";
const CONTENT_BG = "#fbfcfe"; // barely-tinted white, not stark white
const BORDER = "#e2e8f0";
const TEXT_BODY = "#334155";
const TEXT_MUTED = "#64748b";
const TEXT_FAINT = "#94a3b8";
const FONT = "Arial, Helvetica, sans-serif";

/**
 * A small house pictogram (roof + door), not a bare letter — built from two
 * stacked CSS-border/box shapes in normal document flow (no absolute
 * positioning, no overlap tricks) so it degrades gracefully even in clients
 * with weak CSS support: worst case it's just two colored blobs on the badge,
 * never a broken layout. No hosted image exists for this backend to point an
 * <img> at, and inline SVG is stripped outright by Outlook desktop, which is
 * why this stays pure table/CSS.
 */
function houseMarkHtml(): string {
    return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
            <td width="48" height="48" bgcolor="${BRAND_NAVY}" align="center" valign="middle" style="border-radius: 10px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                        <td align="center" style="line-height: 0; padding-bottom: 1px;">
                            <div style="width: 0; height: 0; border-left: 11px solid transparent; border-right: 11px solid transparent; border-bottom: 13px solid ${BRAND_BLUE};"></div>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="line-height: 0;">
                            <div style="width: 14px; height: 11px; background: ${BRAND_BLUE_LIGHT};"></div>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>`;
}

function wordmarkHtml(): string {
    return `
    <div style="font-family: ${FONT}; font-size: 17px; font-weight: bold; color: #ffffff; line-height: 1.1; margin-top: 10px;">HomeLink</div>
    <div style="font-family: ${FONT}; font-size: 9.5px; font-weight: bold; letter-spacing: 2px; color: ${BRAND_BLUE_LIGHT};">RWANDA</div>`;
}

/**
 * Primary call-to-action for link-bearing emails. The plain-text link below
 * the button is not decoration — some clients (or security scanners) strip
 * button styling or block the click entirely, so the raw URL is the fallback
 * path to the same destination.
 */
function ctaButton(label: string, href: string): string {
    return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0 16px;">
        <tr>
            <td bgcolor="${BRAND_BLUE}" style="border-radius: 6px;">
                <a href="${href}" target="_blank" rel="noopener noreferrer"
                   style="display: inline-block; padding: 13px 30px; font-family: ${FONT}; font-size: 14px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 6px;">
                    ${label}
                </a>
            </td>
        </tr>
    </table>
    <p style="margin: 0 0 8px; font-family: ${FONT}; font-size: 12px; color: ${TEXT_FAINT};">
        Or paste this link into your browser:<br>
        <a href="${href}" style="color: ${BRAND_BLUE}; word-break: break-all;">${href}</a>
    </p>`;
}

export function wrapTemplate(title: string, bodyHtml: string): string {
    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CANVAS}">
        <tr>
            <td align="center" style="padding: 32px 16px;">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
                       style="max-width: 600px; width: 100%; border-radius: 12px; overflow: hidden;">
                    <tr>
                        <td bgcolor="${BRAND_NAVY}">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td width="180" bgcolor="${BRAND_NAVY_PANEL}" align="center" style="padding: 24px 16px;">
                                        ${houseMarkHtml()}
                                        ${wordmarkHtml()}
                                    </td>
                                    <td bgcolor="${BRAND_NAVY}" style="padding: 20px 28px;">
                                        <div style="font-family: ${FONT}; font-size: 21px; font-weight: bold; letter-spacing: 0.4px; color: #ffffff; text-transform: uppercase; line-height: 1.3;">
                                            ${title}
                                        </div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td bgcolor="${CONTENT_BG}" style="padding: 32px; border-left: 1px solid ${BORDER}; border-right: 1px solid ${BORDER};">
                            <div style="font-family: ${FONT}; font-size: 14px; line-height: 1.65; color: ${TEXT_BODY};">
                                ${bodyHtml}
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td bgcolor="${BRAND_NAVY}" style="padding: 16px 32px;">
                            <p style="margin: 0; font-family: ${FONT}; font-size: 11px; color: ${BRAND_BLUE_LIGHT}; line-height: 1.6;">
                                HomeLink &mdash; Property Rental Management &middot; Kigali, Rwanda<br>
                                <span style="color: #6b83ab;">This is an automated message &mdash; please don't reply directly to this email.</span>
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>`;
}

export function verificationEmailTemplate(firstName: string, link: string): string {
    return wrapTemplate(
        "Verify your email",
        `<p style="margin: 0 0 4px;">Hi ${firstName},</p>
         <p style="margin: 0;">Welcome to HomeLink. Please verify your email address to finish setting up your account.</p>
         ${ctaButton("Verify email", link)}`
    );
}

export function passwordResetTemplate(firstName: string, link: string): string {
    return wrapTemplate(
        "Reset your password",
        `<p style="margin: 0 0 4px;">Hi ${firstName},</p>
         <p style="margin: 0;">We received a request to reset your HomeLink password. This link expires in 1 hour.</p>
         ${ctaButton("Reset password", link)}
         <p style="margin: 0; color: ${TEXT_MUTED};">If you didn't request this, you can safely ignore this email &mdash; your password won't change.</p>`
    );
}

export function rentReminderTemplate(firstName: string, amount: string, dueDate: string): string {
    return wrapTemplate(
        "Rent payment reminder",
        `<p style="margin: 0 0 4px;">Hi ${firstName},</p>
         <p style="margin: 0;">This is a reminder that a rent payment of <strong style="color: ${BRAND_NAVY};">${amount}</strong> is due on <strong style="color: ${BRAND_NAVY};">${dueDate}</strong>.</p>`
    );
}

export function genericNotificationTemplate(firstName: string, message: string): string {
    return wrapTemplate(
        "HomeLink Notification",
        `<p style="margin: 0 0 4px;">Hi ${firstName},</p><p style="margin: 0;">${message}</p>`
    );
}

export function setPasswordTemplate(firstName: string, link: string, propertyName?: string, unitLabel?: string): string {
    const asTenantOf = propertyName
        ? ` as the tenant of ${
              unitLabel
                  ? `<strong style="color: ${BRAND_NAVY};">${unitLabel}</strong> at <strong style="color: ${BRAND_NAVY};">${propertyName}</strong>`
                  : `<strong style="color: ${BRAND_NAVY};">${propertyName}</strong>`
          }`
        : "";
    return wrapTemplate(
        "Set your HomeLink password",
        `<p style="margin: 0 0 4px;">Hi ${firstName},</p>
         <p style="margin: 0;">A HomeLink account has been created for you${asTenantOf}. Set your password below to finish setting it up and sign in. This link expires in 24 hours.</p>
         ${ctaButton("Set password", link)}`
    );
}

export function inviteTemplate(inviterName: string, roleLabel: string, link: string, propertyName?: string): string {
    const forProperty = propertyName ? ` for <strong style="color: ${BRAND_NAVY};">${propertyName}</strong>` : "";
    return wrapTemplate(
        "You've been invited to HomeLink",
        `<p style="margin: 0 0 4px;">${inviterName} has invited you to join HomeLink as a <strong style="color: ${BRAND_NAVY};">${roleLabel}</strong>${forProperty}.</p>
         <p style="margin: 0;">This invitation expires in 7 days.</p>
         ${ctaButton("Accept invitation", link)}`
    );
}

export function leadNotificationTemplate(
    type: "contact" | "get_started",
    fullName: string,
    email: string,
    details: string
): string {
    const title = type === "contact" ? "New contact message" : "New \"Get Started\" request";
    return wrapTemplate(
        title,
        `<p style="margin: 0 0 4px;">${fullName} (${email}) submitted the ${type === "contact" ? "contact" : "get started"} form.</p>
         <p style="margin: 0;">${details}</p>`
    );
}

export function newDeviceLoginTemplate(firstName: string, code: string): string {
    return wrapTemplate(
        "Confirm this sign-in",
        `<p style="margin: 0 0 4px;">Hi ${firstName},</p>
         <p style="margin: 0 0 20px;">We noticed a sign-in to your HomeLink account from a device we don't recognize. Enter this code to continue:</p>
         <table role="presentation" cellpadding="0" cellspacing="0" border="0">
             <tr>
                 <td bgcolor="#f8fafc" style="border: 1px solid ${BORDER}; border-radius: 8px; padding: 14px 24px;">
                     <span style="font-family: ${FONT}; font-size: 26px; font-weight: bold; letter-spacing: 6px; color: ${BRAND_NAVY};">${code}</span>
                 </td>
             </tr>
         </table>
         <p style="margin: 20px 0 0; color: ${TEXT_MUTED};">This code expires in 10 minutes. If this wasn't you, change your password immediately.</p>`
    );
}
