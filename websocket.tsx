import React, {
  useEffect,
  useRef,
  useContext,
  useState,
  useCallback,
} from "react";
import { WebsocketContext } from "../contexts/WebsocketContext";

type PeerConnection = {
  pc: RTCPeerConnection;
  iceCandidates: RTCIceCandidateInit[];
};

type PeerConnections = {
  [key: string]: PeerConnection;
};

const Websocket = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socket = useContext(WebsocketContext);
  const [peerConnections, setPeerConnections] = useState<PeerConnections>({});
  const [sessionCode, setSessionCode] = useState<string>("");
  const [inputSessionCode, setInputSessionCode] = useState<string>("");
  const [isSessionJoined, setIsSessionJoined] = useState<boolean>(false);

  const createPeerConnection = useCallback(
    (socketId: string): PeerConnection => {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      const iceCandidates: RTCIceCandidateInit[] = [];

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("newIceCandidate", {
            candidate: event.candidate,
            socketId,
          });
        }
      };

      pc.ontrack = (event) => {
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
        }
      };

      const newPeerConnection = { pc, iceCandidates };
      setPeerConnections((prev) => ({
        ...prev,
        [socketId]: newPeerConnection,
      }));

      if (videoRef.current && videoRef.current.srcObject) {
        const mediaStream = videoRef.current.srcObject as MediaStream;
        mediaStream.getTracks().forEach((track) => {
          pc.addTrack(track, mediaStream);
        });

        pc.createOffer().then((offer) => {
          pc.setLocalDescription(offer);
          socket.emit("newOffer", { offer, socketId });
        });
      }

      return newPeerConnection;
    },
    [socket]
  );

  useEffect(() => {
    socket.on("connect", () => {
      console.log("Connected to signaling server");
    });

    socket.on("sessionCode", (newCode: string) => {
      setSessionCode(newCode);
    });

    socket.on("joinSuccess", () => {
      alert("Successfully joined the session");
      setIsSessionJoined(true);
    });

    socket.on("joinFailure", () => {
      alert("Invalid session code. Please try again.");
    });

    socket.on(
      "onOffer",
      async ({
        offer,
        socketId,
      }: {
        offer: RTCSessionDescriptionInit;
        socketId: string;
      }) => {
        const { pc, iceCandidates } = createPeerConnection(socketId);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("newAnswer", { answer, socketId });

        iceCandidates.forEach(async (candidate) => {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        });
      }
    );

    socket.on(
      "onAnswer",
      async ({
        answer,
        socketId,
      }: {
        answer: RTCSessionDescriptionInit;
        socketId: string;
      }) => {
        const { pc } = peerConnections[socketId] || {};
        if (pc && pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
      }
    );

    socket.on(
      "onIceCandidate",
      async ({
        candidate,
        socketId,
      }: {
        candidate: RTCIceCandidateInit;
        socketId: string;
      }) => {
        const { pc, iceCandidates } = peerConnections[socketId] || {};
        if (pc) {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            iceCandidates.push(candidate);
          }
        }
      }
    );

    socket.on("getOffer", ({ newClient }: { newClient: string }) => {
      createPeerConnection(newClient);
    });

    socket.on("screenShareEnded", () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        alert("Screen Share Stopped");
      }
    });

    return () => {
      socket.off("sessionCode");
      socket.off("joinSuccess");
      socket.off("joinFailure");
      socket.off("onOffer");
      socket.off("onAnswer");
      socket.off("onIceCandidate");
      socket.off("getOffer");
      socket.off("screenShareEnded");
    };
  }, [createPeerConnection, peerConnections, socket]);

  const handleGenerateCode = () => {
    socket.emit("startScreenShare");
  };

  const handleShareScreen = async () => {
    if (!sessionCode) {
      alert("Please generate a session code first.");
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      mediaStream.getVideoTracks()[0].onended = function () {
        socket.emit("screenShareStopped");
        if (videoRef.current) {
          videoRef.current.srcObject = null;
          alert("Screen Share Stopped");
        }
      };
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }

      const clients = Object.keys(peerConnections);
      clients.forEach((clientId) => {
        const { pc } = peerConnections[clientId];
        mediaStream.getTracks().forEach((track) => {
          pc.addTrack(track, mediaStream);
        });
        pc.createOffer().then((offer) => {
          pc.setLocalDescription(offer);
          socket.emit("newOffer", { offer, socketId: clientId });
        });
      });
    } catch (error) {
      console.error("Error accessing screen stream:", error);
    }
  };

  const handleJoinSession = () => {
    socket.emit("joinSession", { code: inputSessionCode });
  };

  return (
    <div>
      <h2>Screen Share</h2>
      <button onClick={handleGenerateCode}>Generate Code</button>
      <button onClick={handleShareScreen}>Share Screen</button>
      <div>
        <input
          type="text"
          value={inputSessionCode}
          onChange={(e) => setInputSessionCode(e.target.value)}
          placeholder="Enter session code"
        />
        {!isSessionJoined && (
          <button onClick={handleJoinSession}>Join Session</button>
        )}
      </div>
      {sessionCode && <p>Your session code: {sessionCode}</p>}
      <div className="video-container">
        <video ref={videoRef} autoPlay playsInline controls />
      </div>
    </div>
  );
};

export default Websocket;