import type { InAppBrowserObject } from '@awesome-cordova-plugins/in-app-browser';
import type {
  AppRequest, ConnectEvent,
  ConnectEventError, ConnectRequest, DeviceInfo, RpcMethod, WalletEvent,
  WalletResponse,
} from '@tonconnect/protocol';
import { BottomSheet } from 'native-bottom-sheet';
import { useMemo, useRef, useState } from '../../../lib/teact/teact';
import { getGlobal } from '../../../global';

import { CONNECT_EVENT_ERROR_CODES, SEND_TRANSACTION_ERROR_CODES } from '../../../api/tonConnect/types';

import { TONCONNECT_PROTOCOL_VERSION } from '../../../config';
import { logDebugError } from '../../../util/logs';
import { tonConnectGetDeviceInfo } from '../../../util/tonConnectEnvironment';
import { IS_DELEGATING_BOTTOM_SHEET } from '../../../util/windowEnvironment';
import { callApi } from '../../../api';
import { useWebViewBridge } from './useWebViewBridge';

import useLastCallback from '../../../hooks/useLastCallback';

interface WebViewTonConnectBridge {
  deviceInfo: DeviceInfo;
  protocolVersion: number;
  isWalletBrowser: boolean;
  connect(protocolVersion: number, message: ConnectRequest): Promise<ConnectEvent>;
  restoreConnection(): Promise<ConnectEvent>;
  disconnect(): Promise<void>;
  send<T extends RpcMethod>(message: AppRequest<T>): Promise<WalletResponse<T>>;
}

interface OwnProps {
  endpoint: string;
  isConnected?: boolean;
  onHideBrowser: NoneToVoidFunction;
  onShowBrowser: NoneToVoidFunction;
}

export function useDappBridge({
  endpoint,
  isConnected,
  onHideBrowser,
  onShowBrowser,
}: OwnProps) {
  // eslint-disable-next-line no-null/no-null
  const inAppBrowserRef = useRef<InAppBrowserObject>(null);
  const [requestId, setRequestId] = useState(0);
  const origin = useMemo(() => {
    return new URL(endpoint).origin.toLowerCase();
  }, [endpoint]);

  const bridgeObject = useMemo((): WebViewTonConnectBridge => {
    const dappRequest = {
      origin,
      accountId: getGlobal().currentAccountId,
    };

    return {
      deviceInfo: tonConnectGetDeviceInfo(),
      protocolVersion: TONCONNECT_PROTOCOL_VERSION,
      isWalletBrowser: true,

      connect: async (protocolVersion, request) => {
        try {
          if (protocolVersion > TONCONNECT_PROTOCOL_VERSION) {
            return buildConnectError(
              requestId,
              'Unsupported protocol version',
              CONNECT_EVENT_ERROR_CODES.BAD_REQUEST_ERROR,
            );
          }
          verifyConnectRequest(request);

          inAppBrowserRef.current?.hide();
          onHideBrowser();
          if (IS_DELEGATING_BOTTOM_SHEET) {
            await BottomSheet.enable();
          }

          const response = await callApi(
            'tonConnect_connect',
            dappRequest,
            request,
            requestId,
          );
          if (IS_DELEGATING_BOTTOM_SHEET) {
            await BottomSheet.disable();
          }

          inAppBrowserRef.current?.show();
          onShowBrowser();
          setRequestId(requestId + 1);

          if (response?.event === 'connect') {
            response.payload.device = tonConnectGetDeviceInfo();
          }

          return response;
        } catch (err: any) {
          logDebugError('useDAppBridge:connect', err);
          if (IS_DELEGATING_BOTTOM_SHEET) {
            await BottomSheet.disable();
          }
          inAppBrowserRef.current?.show();
          onShowBrowser();

          if ('event' in err && 'id' in err && 'payload' in err) {
            return err;
          }

          return buildConnectError(
            requestId,
            err?.message,
            CONNECT_EVENT_ERROR_CODES.UNKNOWN_ERROR,
          );
        }
      },

      restoreConnection: async () => {
        try {
          const response = await callApi(
            'tonConnect_reconnect',
            dappRequest,
            requestId,
          );
          setRequestId(requestId + 1);

          if (response?.event === 'connect') {
            response.payload.device = tonConnectGetDeviceInfo();
          }

          return response;
        } catch (err: any) {
          logDebugError('useDAppBridge:reconnect', err);

          if ('event' in err && 'id' in err && 'payload' in err) {
            return err;
          }

          return buildConnectError(
            requestId,
            err?.message,
            CONNECT_EVENT_ERROR_CODES.UNKNOWN_ERROR,
          );
        }
      },

      disconnect: async () => {
        setRequestId(0);
        await callApi(
          'tonConnect_disconnect',
          dappRequest,
          { id: requestId.toString(), method: 'disconnect', params: [] },
        );
      },

      send: async <T extends RpcMethod>(request: AppRequest<T>) => {
        setRequestId(requestId + 1);

        if (!isConnected) {
          return {
            error: {
              code: SEND_TRANSACTION_ERROR_CODES.UNKNOWN_APP_ERROR,
              message: 'Unknown app',
            },
            id: request.id.toString(),
          };
        }

        try {
          switch (request.method) {
            case 'sendTransaction': {
              inAppBrowserRef.current?.hide();
              onHideBrowser();
              if (IS_DELEGATING_BOTTOM_SHEET) {
                await BottomSheet.enable();
              }

              const callResponse = await callApi(
                'tonConnect_sendTransaction',
                dappRequest,
                request,
              );
              if (IS_DELEGATING_BOTTOM_SHEET) {
                await BottomSheet.disable();
              }
              inAppBrowserRef.current?.show();
              onShowBrowser();

              return callResponse!;
            }

            case 'disconnect': {
              const callResponse = await callApi(
                'tonConnect_disconnect',
                dappRequest,
                request,
              );

              return callResponse!;
            }

            case 'signData': {
              inAppBrowserRef.current?.hide();
              onHideBrowser();
              if (IS_DELEGATING_BOTTOM_SHEET) {
                await BottomSheet.enable();
              }
              const callResponse = await callApi(
                'tonConnect_signData',
                dappRequest,
                request,
              );
              if (IS_DELEGATING_BOTTOM_SHEET) {
                await BottomSheet.disable();
              }
              inAppBrowserRef.current?.show();
              onShowBrowser();

              return callResponse!;
            }

            default:
              return {
                error: {
                  code: SEND_TRANSACTION_ERROR_CODES.BAD_REQUEST_ERROR,
                  message: `Method "${request!.method}" is not supported`,
                },
                id: request!.id.toString(),
              };
          }
        } catch (err: any) {
          logDebugError('useDAppBridge:send', err);
          if (IS_DELEGATING_BOTTOM_SHEET) {
            await BottomSheet.disable();
          }
          inAppBrowserRef.current?.show();
          onShowBrowser();

          return {
            error: {
              code: SEND_TRANSACTION_ERROR_CODES.UNKNOWN_ERROR,
              message: err?.message,
            },
            id: request!.id.toString(),
          };
        }
      },
    };
  }, [isConnected, onHideBrowser, onShowBrowser, origin, requestId]);

  const [
    injectedJavaScriptBeforeContentLoaded,
    onMessage,
    sendEvent,
  ] = useWebViewBridge<WebViewTonConnectBridge, WalletEvent>(inAppBrowserRef, bridgeObject);

  const disconnect = useLastCallback(async () => {
    try {
      // onDisconnect(endpoint, requestId);
      sendEvent({ event: 'disconnect', payload: {}, id: requestId });
    } catch (err: any) {
      logDebugError('disconnect', err);
    }
  });

  return {
    inAppBrowserRef,
    injectedJavaScriptBeforeContentLoaded,
    onMessage,
    disconnect,
  };
}

function buildConnectError(
  id: number,
  msg = 'Unknown error.',
  code?: CONNECT_EVENT_ERROR_CODES,
): ConnectEventError {
  return {
    event: 'connect_error',
    id,
    payload: {
      code: code || CONNECT_EVENT_ERROR_CODES.UNKNOWN_ERROR,
      message: msg,
    },
  };
}

function verifyConnectRequest(request: ConnectRequest) {
  if (!(request && request.manifestUrl && request.items?.length)) {
    throw new Error('Wrong request data');
  }
}
