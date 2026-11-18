# Utkast: ansökan om SES produktionsåtkomst

Thomas skickar in. Region: `eu-north-1` (Stockholm). Konsol: SES → Account dashboard → Request production access.
Svara på engelska. Byt `<...>`. Ta inte med riktiga adresser i ansökan.

**Mail type:** Transactional (närmast: "service communications"). Välj *inte* Marketing om ni inte behöver, men var ärlig: det är föreningsinformation.

**Website URL:** `<D&G:s webbplats eller sida som beskriver tjänsten>`

**Use case description (utkast):**

> We run a small service that lets Swedish housing associations (bostadsrättsföreningar) send occasional information emails to their own members and residents: board notices, maintenance windows, meeting invitations. Each association is a separate tenant with its own address list, managed by the association's own board. We act as data processor under a written data processing agreement.
>
> Volume: roughly <X> associations, <50–500> recipients each, about <2–6> emails per association per month. Expected total below <3,000> emails per month. No purchased or scraped lists. Recipients are the association's own members/residents whose addresses were given to the association for this purpose.
>
> Opt-out: every email contains a visible unsubscribe link and the `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058). Unsubscribe takes effect immediately and the address is suppressed for that association.
>
> Bounces and complaints: we subscribe to SES event notifications through SNS (configuration set with Bounce, Complaint and Delivery events). Hard bounces and complaints add the address to a per-tenant suppression list immediately and it is never mailed again. Soft bounces are counted and the address is deactivated after repeated failures.
>
> Sending domain: `utskick.danielssongentry.se` with Easy DKIM, a custom MAIL FROM domain, SPF and a DMARC policy. We do not use open or click tracking.
>
> Safeguards: two-factor authentication for all users who can send, an explicit confirmation step showing recipient count before each send, per-tenant daily send limits, and an audit log.

**Additional contact addresses:** `<D&G drift-adress>`
**Preferred contact language:** English (eller Swedish)
**Acknowledgement:** bekräfta policyn.

## Före ansökan (så att den inte avslås)
- Domänidentiteten `utskick.danielssongentry.se` skapad och verifierad, DKIM grön.
- Konfigurationsset med SNS-händelsemål på plats (kan vara tomt topic).
- Förbered svar om AWS ber om mer information inom 24 h. Svara konkret, med siffror.

## Efter godkännande
- Be om en rimlig dagskvot. Standard räcker för piloten.
- Sätt kontolevel-suppression till bounces + complaints (SES-nivå, som komplement till vår egen).
