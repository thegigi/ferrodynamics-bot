const fs = require('fs');

function replaceExact(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1;

  if (count !== 1) {
    throw new Error(
      `${label}: expected exactly one target, found ${count}`
    );
  }

  return source.replace(oldText, newText);
}

const clientPath =
  'node_modules/whatsapp-web.js/src/Client.js';

let clientSource =
  fs.readFileSync(clientPath, 'utf8');

/*
 * WWebJS may survive a WhatsApp Web navigation while
 * WAWebCollections.Msg is recreated. In that case the
 * previous Msg.on("add") listener is no longer operational.
 */
clientSource = replaceExact(
  clientSource,
`                const injected = await this.pupPage.evaluate(async () => {
                    return typeof window.WWebJS !== 'undefined';
                });`,
`                const listenerState =
                    await this.pupPage.evaluate(async () => {
                        let currentMsg = null;

                        try {
                            currentMsg =
                                window
                                    .require('WAWebCollections')
                                    ?.Msg || null;
                        } catch {
                            currentMsg = null;
                        }

                        return {
                            utilsInjected:
                                typeof window.WWebJS !==
                                'undefined',

                            messageListenerBound:
                                Boolean(currentMsg) &&
                                window
                                    .__ferroBoundMsgCollection ===
                                    currentMsg,
                        };
                    });

                const injected =
                    listenerState.utilsInjected &&
                    listenerState.messageListenerBound;

                console.log(
                    '[WWEBJS_BIND_CHECK]',
                    'utilsInjected=' +
                        listenerState.utilsInjected,
                    'messageListenerBound=' +
                        listenerState.messageListenerBound,
                    'action=' +
                        (injected
                            ? 'reuse'
                            : 'rebind')
                );`,
  'Client listener-state patch'
);

/*
 * Mark the exact Msg collection on which the listener was attached.
 * If WhatsApp Web replaces the collection, the comparison above fails
 * and attachEventListeners() is executed again.
 */
const msgListenerStart =
  clientSource.indexOf(
    "            Msg.on('add', (msg) => {"
  );

if (msgListenerStart < 0) {
  throw new Error(
    'Msg.on("add") listener was not found'
  );
}

const nextListener =
  "            Chat.on('change:unreadCount'";

const nextListenerIndex =
  clientSource.indexOf(
    nextListener,
    msgListenerStart
  );

if (nextListenerIndex < 0) {
  throw new Error(
    'Listener insertion point was not found'
  );
}

clientSource =
  clientSource.slice(0, nextListenerIndex) +
`            window.__ferroBoundMsgCollection =
                Msg;

            window.onFerroListenerBoundEvent?.({
                msgCount:
                    typeof Msg.length === 'number'
                        ? Msg.length
                        : null,
            });

` +
  clientSource.slice(nextListenerIndex);

/*
 * Add a Node-side callback so the binding is visible in ACA logs.
 */
clientSource = replaceExact(
  clientSource,
`    async attachEventListeners() {
        await exposeFunctionIfAbsent(`,
`    async attachEventListeners() {
        await exposeFunctionIfAbsent(
            this.pupPage,
            'onFerroListenerBoundEvent',
            (details) => {
                console.log(
                    '[WWEBJS_LISTENER_BOUND]',
                    'msgCount=' +
                        (details?.msgCount ?? 'unknown')
                );
            },
        );
        await exposeFunctionIfAbsent(
            this.pupPage,
            'onFerroMsgAddEvent',
            (details) => {
                console.log(
                    '[WWEBJS_MSG_ADD]',
                    'type=' + (details?.type ?? 'unknown'),
                    'isNewMsg=' +
                        String(details?.isNewMsg),
                    'fromMe=' +
                        String(details?.fromMe),
                    'id=' + (details?.id ?? 'unknown')
                );
            },
        );

        await exposeFunctionIfAbsent(`,
  'Listener-bound logging patch'
);

fs.writeFileSync(
  clientPath,
  clientSource
);


/*
 * Raw diagnostic: prove whether WhatsApp Web actually fires
 * WAWebCollections.Msg "add".
 */
clientSource = replaceExact(
  clientSource,
`            Msg.on('add', (msg) => {
                if (!msg.isNewMsg) return;`,
`            Msg.on('add', (msg) => {
                window.onFerroMsgAddEvent?.({
                    type: msg.type || null,
                    isNewMsg: msg.isNewMsg,
                    fromMe: msg.id?.fromMe,
                    id:
                        msg.id?._serialized ||
                        msg.id?.id ||
                        null,
                });

                if (!msg.isNewMsg) return;`,
  'Raw Msg add diagnostic'
);

fs.writeFileSync(
  clientPath,
  clientSource
);


/*
 * Prevent afterAuthReady() from creating multiple concurrent
 * RemoteAuth backup timers following repeated READY events.
 */
const remoteAuthPath =
  'node_modules/whatsapp-web.js/src/authStrategies/RemoteAuth.js';

let remoteAuthSource =
  fs.readFileSync(remoteAuthPath, 'utf8');

remoteAuthSource = replaceExact(
  remoteAuthSource,
`        var self = this;
        this.backupSync = setInterval(async function () {`,
`        clearInterval(this.backupSync);

        console.log(
            '[REMOTE_AUTH_TIMER_RESET]',
            'intervalMs=' + this.backupSyncIntervalMs
        );

        var self = this;
        this.backupSync = setInterval(async function () {`,
  'RemoteAuth timer patch'
);

fs.writeFileSync(
  remoteAuthPath,
  remoteAuthSource
);

console.log(
  'Applied WhatsApp listener rebind and RemoteAuth timer patches'
);
