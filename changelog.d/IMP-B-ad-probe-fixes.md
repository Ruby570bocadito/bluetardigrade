The Active Directory connection test now lets the engine use its full 45-second budget before the console gives up, so slow LDAP links across a WAN no longer fail from the browser side alone.
Bind passwords with leading or trailing spaces are sent exactly as typed when saving or testing the Active Directory connection; only an all-whitespace field still means "no change".
