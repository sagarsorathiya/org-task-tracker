// ──────────────────────────────────────────────
// LDAP Helpers — ldapjs bind/search
// ──────────────────────────────────────────────

import ldap from 'ldapjs';
import { logger } from './logger';
import { getSecret } from './secrets';

export interface LdapUserAttributes {
  dn: string;
  sAMAccountName: string;
  displayName?: string;
  mail?: string;
  department?: string;
}

function createClient(): ldap.Client {
  const url = process.env.LDAP_URL || 'ldap://10.0.0.1:389';
  return ldap.createClient({
    url,
    connectTimeout: 10000,
    timeout: 10000,
  });
}

/**
 * Search for a user by sAMAccountName
 */
export async function ldapSearch(username: string): Promise<LdapUserAttributes | null> {
  const client = createClient();
  const bindDN = process.env.LDAP_BIND_DN || '';
  const bindPassword = getSecret('LDAP_BIND_PASSWORD');
  const baseDN = process.env.LDAP_BASE_DN || '';

  return new Promise((resolve, reject) => {
    client.bind(bindDN, bindPassword, (bindErr) => {
      if (bindErr) {
        logger.error({ err: bindErr }, 'LDAP service bind failed');
        client.destroy();
        return reject(new Error('LDAP service bind failed'));
      }

      const filter = `(sAMAccountName=${username.replace(/[\\*()\x00]/g, '')})`;

      client.search(baseDN, {
        filter,
        scope: 'sub',
        attributes: ['dn', 'sAMAccountName', 'displayName', 'mail', 'department'],
      }, (searchErr, res) => {
        if (searchErr) {
          logger.error({ err: searchErr }, 'LDAP search failed');
          client.destroy();
          return reject(new Error('LDAP search failed'));
        }

        let found: LdapUserAttributes | null = null;

        res.on('searchEntry', (entry) => {
          const obj = entry.pojo;
          found = {
            dn: obj.objectName,
            sAMAccountName: obj.attributes.find((a) => a.type === 'sAMAccountName')?.values[0] || username,
            displayName: obj.attributes.find((a) => a.type === 'displayName')?.values[0],
            mail: obj.attributes.find((a) => a.type === 'mail')?.values[0],
            department: obj.attributes.find((a) => a.type === 'department')?.values[0],
          };
        });

        res.on('error', (err) => {
          logger.error({ err }, 'LDAP search stream error');
          client.destroy();
          reject(new Error('LDAP search error'));
        });

        res.on('end', () => {
          client.unbind(() => client.destroy());
          resolve(found);
        });
      });
    });
  });
}

/**
 * Search LDAP users by username/displayName/mail (partial match)
 */
export async function ldapSearchUsers(searchTerm: string, limit = 10): Promise<LdapUserAttributes[]> {
  const client = createClient();
  const bindDN = process.env.LDAP_BIND_DN || '';
  const bindPassword = getSecret('LDAP_BIND_PASSWORD');
  const baseDN = process.env.LDAP_BASE_DN || '';
  const safeTerm = searchTerm.replace(/[\\*()\x00]/g, '').trim();

  if (!safeTerm || !baseDN) {
    return [];
  }

  return new Promise((resolve, reject) => {
    client.bind(bindDN, bindPassword, (bindErr) => {
      if (bindErr) {
        logger.error({ err: bindErr }, 'LDAP service bind failed for user search');
        client.destroy();
        return reject(new Error('LDAP service bind failed'));
      }

      const filter = `(&(!(sAMAccountName=*$))(|(sAMAccountName=*${safeTerm}*)(displayName=*${safeTerm}*)(mail=*${safeTerm}*)))`;
      client.search(
        baseDN,
        {
          filter,
          scope: 'sub',
          sizeLimit: Math.max(1, Math.min(50, limit)),
          attributes: ['dn', 'sAMAccountName', 'displayName', 'mail', 'department'],
        },
        (searchErr, res) => {
          if (searchErr) {
            logger.error({ err: searchErr }, 'LDAP user search failed');
            client.destroy();
            return reject(new Error('LDAP user search failed'));
          }

          const users: LdapUserAttributes[] = [];

          res.on('searchEntry', (entry) => {
            const obj = entry.pojo;
            const username = obj.attributes.find((a) => a.type === 'sAMAccountName')?.values[0];
            if (!username) return;

            // Computer accounts usually end with '$' (e.g., HOSTNAME$).
            if (String(username).endsWith('$')) return;

            users.push({
              dn: obj.objectName,
              sAMAccountName: String(username),
              displayName: obj.attributes.find((a) => a.type === 'displayName')?.values[0] as string | undefined,
              mail: obj.attributes.find((a) => a.type === 'mail')?.values[0] as string | undefined,
              department: obj.attributes.find((a) => a.type === 'department')?.values[0] as string | undefined,
            });
          });

          res.on('error', (err) => {
            logger.error({ err }, 'LDAP user search stream error');
            client.destroy();
            reject(new Error('LDAP user search error'));
          });

          res.on('end', () => {
            client.unbind(() => client.destroy());
            const deduped = users.filter((user, idx, arr) => arr.findIndex((u) => u.sAMAccountName === user.sAMAccountName) === idx);
            resolve(deduped.slice(0, Math.max(1, Math.min(50, limit))));
          });
        }
      );
    });
  });
}

/**
 * Bind (authenticate) as a specific user
 */
export async function ldapBind(userDN: string, password: string): Promise<boolean> {
  const client = createClient();

  return new Promise((resolve) => {
    client.bind(userDN, password, (err) => {
      client.unbind(() => client.destroy());
      if (err) {
        logger.warn({ userDN }, 'LDAP user bind failed');
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Test LDAP connectivity
 */
export async function testLdapConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    const client = createClient();
    const bindDN = process.env.LDAP_BIND_DN || '';
    const bindPassword = getSecret('LDAP_BIND_PASSWORD');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        client.destroy();
        resolve({ connected: false, error: 'Connection timeout' });
      }, 10000);

      client.bind(bindDN, bindPassword, (err) => {
        clearTimeout(timeout);
        client.unbind(() => client.destroy());
        if (err) {
          resolve({ connected: false, error: err.message });
        } else {
          resolve({ connected: true });
        }
      });
    });
  } catch (err) {
    return { connected: false, error: String(err) };
  }
}
