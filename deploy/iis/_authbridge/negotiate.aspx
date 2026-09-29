<%@ Page Language="C#" %>
<%@ Import Namespace="System.Net" %>
<%@ Import Namespace="System.IO" %>
<script runat="server">
// Bridges IIS Windows Authentication to the Node backend.
//
// Runs natively in the IIS/ASP.NET pipeline (not proxied via ARR) so
// User.Identity.Name is reliably populated after auth succeeds. URL Rewrite
// expands {LOGON_USER} at BeginRequest, before Windows auth runs, so a
// proxied identity header is always empty — hence this page.
//
// Deployed to C:\org-task-tracker\public_iis\_authbridge\negotiate.aspx and
// reached at /api/sso/negotiate via the rewrite rule in the site web.config.
// That location has anonymous auth disabled and Windows auth enabled (set in
// applicationHost.config, since the authentication section is not delegated).
//
// SECRET below must match SSO_BRIDGE_SHARED_SECRET in the app's .env. It is
// deliberately NOT the proxy secret: IIS injects that one onto every proxied
// request, so the ticket route cannot use it to tell this bridge apart from an
// anonymous internet caller.
void Page_Load(object sender, EventArgs e)
{
    const string SECRET = "__SSO_BRIDGE_SHARED_SECRET__";
    const string TICKET_URL = "http://127.0.0.1:4000/api/sso/ticket";

    Response.Clear();
    Response.ContentType = "application/json";
    Response.Cache.SetCacheability(HttpCacheability.NoCache);

    string identity = (User != null && User.Identity != null) ? User.Identity.Name : null;
    if (string.IsNullOrEmpty(identity))
    {
        Response.StatusCode = 401;
        Response.Write("{\"success\":false,\"error\":\"No domain credentials detected\"}");
        Response.End();
        return;
    }

    try
    {
        // Pass the identity through verbatim (DOMAIN\user) so the app can still
        // enforce SSO_ALLOWED_DOMAINS; it does its own parsing.
        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(TICKET_URL);
        req.Method = "GET";
        req.Headers["X-Remote-User"] = identity;
        req.Headers["X-Sso-Bridge-Secret"] = SECRET;
        req.Timeout = 10000;

        HttpWebResponse resp;
        try
        {
            resp = (HttpWebResponse)req.GetResponse();
        }
        catch (WebException wex)
        {
            resp = wex.Response as HttpWebResponse;
            if (resp == null)
            {
                Response.StatusCode = 502;
                Response.Write("{\"success\":false,\"error\":\"Upstream request failed\"}");
                Response.End();
                return;
            }
        }

        using (resp)
        {
            Response.StatusCode = (int)resp.StatusCode;
            using (Stream s = resp.GetResponseStream())
            using (StreamReader sr = new StreamReader(s))
            {
                Response.Write(sr.ReadToEnd());
            }
        }
    }
    catch (Exception ex)
    {
        Response.StatusCode = 500;
        Response.Write("{\"success\":false,\"error\":\"Bridge error: " + ex.Message.Replace("\"", "'") + "\"}");
    }
    Response.End();
}
</script>
