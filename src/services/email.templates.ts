export function wrapTemplate(title: string, bodyHtml: string): string {
    return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2933;">
      <h2 style="color: #0f766e;">${title}</h2>
      ${bodyHtml}
      <p style="margin-top: 32px; font-size: 12px; color: #6b7280;">HomeLink &mdash; Property Rental Management</p>
    </div>`;
}

export function verificationEmailTemplate(firstName: string, link: string): string {
    return wrapTemplate(
        "Verify your email",
        `<p>Hi ${firstName},</p><p>Welcome to HomeLink. Please verify your email by clicking the link below:</p>
         <p><a href="${link}">${link}</a></p>`
    );
}

export function passwordResetTemplate(firstName: string, link: string): string {
    return wrapTemplate(
        "Reset your password",
        `<p>Hi ${firstName},</p><p>We received a request to reset your password. This link expires in 1 hour:</p>
         <p><a href="${link}">${link}</a></p><p>If you did not request this, you can ignore this email.</p>`
    );
}

export function rentReminderTemplate(firstName: string, amount: string, dueDate: string): string {
    return wrapTemplate(
        "Rent payment reminder",
        `<p>Hi ${firstName},</p><p>This is a reminder that a rent payment of <strong>${amount}</strong> is due on <strong>${dueDate}</strong>.</p>`
    );
}

export function genericNotificationTemplate(firstName: string, message: string): string {
    return wrapTemplate("HomeLink Notification", `<p>Hi ${firstName},</p><p>${message}</p>`);
}

export function setPasswordTemplate(firstName: string, link: string): string {
    return wrapTemplate(
        "Set your HomeLink password",
        `<p>Hi ${firstName},</p><p>An administrator created a HomeLink account for you. Set your password by clicking the link below. This link expires in 24 hours:</p>
         <p><a href="${link}">${link}</a></p>`
    );
}

export function inviteTemplate(inviterName: string, roleLabel: string, link: string): string {
    return wrapTemplate(
        `You've been invited to HomeLink`,
        `<p>${inviterName} has invited you to join HomeLink as a ${roleLabel}.</p>
         <p>Click the link below to accept the invitation. This link expires in 7 days:</p>
         <p><a href="${link}">${link}</a></p>`
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
        `<p>${fullName} (${email}) submitted the ${type === "contact" ? "contact" : "get started"} form.</p>
         <p>${details}</p>`
    );
}

export function newDeviceLoginTemplate(firstName: string, code: string): string {
    return wrapTemplate(
        "Confirm this sign-in",
        `<p>Hi ${firstName},</p><p>We noticed a sign-in to your HomeLink account from a device we don't recognize. Enter this code to continue:</p>
         <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${code}</p>
         <p>This code expires in 10 minutes. If this wasn't you, change your password immediately.</p>`
    );
}
