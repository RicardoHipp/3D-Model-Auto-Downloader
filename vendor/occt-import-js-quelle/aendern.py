# -*- coding: utf-8 -*-
"""Aenderungen an occt-import-js 0.0.23 fuer den 3D Model Auto-Downloader.

1. STEP einlesen und das Dokument behalten (LoadStepFile), danach beliebig
   oft neu zerlegen (RetriangulateStepFile), wieder freigeben
   (ReleaseStepFile). ReadStepFile bleibt unveraendert verfuegbar.
2. Vor dem Zerlegen die vorhandene Zerlegung loeschen - sonst behaelt
   BRepMesh eine feinere, wenn man zu einer groeberen Stufe zurueckkehrt.
3. Ecken und Dreiecke als Float32Array/Uint32Array zurueckgeben statt Zahl
   fuer Zahl ueber die Grenze zu JavaScript zu schreiben.
4. Mit -sDYNAMIC_EXECUTION=0 bauen: kein erzeugter Code, also auch in einer
   Chrome-Erweiterung mit Manifest V3 lauffaehig.

Aufruf: python aendern.py <Quellordner>
"""
import io, os, sys

QUELLE = sys.argv[1]

def aendere(datei, alt, neu):
    pfad = os.path.join(QUELLE, datei)
    s = io.open(pfad, encoding='utf-8', newline='').read()
    # Die Dateien haben teils CRLF - vergleichen ohne Ruecksicht darauf.
    crlf = '\r\n' in s
    s = s.replace('\r\n', '\n')
    if s.count(alt) != 1:
        raise SystemExit('NICHT GENAU EINMAL GEFUNDEN in %s:\n%s' % (datei, alt[:200]))
    s = s.replace(alt, neu, 1)
    if crlf:
        s = s.replace('\n', '\r\n')
    io.open(pfad, 'w', encoding='utf-8', newline='').write(s)

# ---------------------------------------------------------------- 2.
aendere('occt-import-js/src/importer-utils.cpp',
        '#include <BRepMesh_IncrementalMesh.hxx>\n',
        '#include <BRepMesh_IncrementalMesh.hxx>\n#include <BRepTools.hxx>\n')
aendere('occt-import-js/src/importer-utils.cpp',
        '    BRepMesh_IncrementalMesh mesh (shape, linDeflection, Standard_False, angDeflection);\n',
        '    // Vorhandene Zerlegung verwerfen: BRepMesh ueberspringt Flaechen, die\n'
        '    // schon feiner zerlegt sind, als verlangt - ein Wechsel zu einer\n'
        '    // groeberen Stufe haette sonst keine Wirkung.\n'
        '    BRepTools::Clean (shape);\n'
        '    BRepMesh_IncrementalMesh mesh (shape, linDeflection, Standard_False, angDeflection);\n')

# ---------------------------------------------------------------- 1. Parameter als Kopie
aendere('occt-import-js/src/importer-xcaf.cpp',
        """private:
    const Handle (XCAFDoc_ShapeTool)& shapeTool;
    const Handle (XCAFDoc_ColorTool)& colorTool;
    const ImportParams& params;
};""",
        """private:
    const Handle (XCAFDoc_ShapeTool)& shapeTool;
    const Handle (XCAFDoc_ColorTool)& colorTool;
    // Als Kopie: Beim erneuten Zerlegen gelten andere Werte als beim Laden,
    // und der Aufrufer haelt sie nicht so lange vor wie dieser Knoten lebt.
    const ImportParams params;
};""")

aendere('occt-import-js/src/importer-xcaf.cpp',
        """NodePtr ImporterXcaf::GetRootNode () const
{
    return rootNode;
}""",
        """NodePtr ImporterXcaf::GetRootNode () const
{
    return rootNode;
}

void ImporterXcaf::SetParams (const ImportParams& params)
{
    // Das Dokument bleibt, nur der Wurzelknoten wird mit den neuen Werten
    // ersetzt; er zerlegt beim naechsten Auslesen neu.
    rootNode = std::make_shared<const XcafRootNode> (shapeTool, colorTool, params);
}""")

aendere('occt-import-js/src/importer-xcaf.hpp',
        """    virtual NodePtr GetRootNode () const override;
""",
        """    virtual NodePtr GetRootNode () const override;
    void SetParams (const ImportParams& params);
""")

# ---------------------------------------------------------------- 3. + 1. js-interface
aendere('occt-import-js/src/js-interface.cpp',
        """            int vertexCount = 0;
            int normalCount = 0;
            int triangleCount = 0;
            int brepFaceCount = 0;

            emscripten::val positionArr (emscripten::val::array ());
            emscripten::val normalArr (emscripten::val::array ());
            emscripten::val indexArr (emscripten::val::array ());
            emscripten::val brepFaceArr (emscripten::val::array ());

            mesh.EnumerateFaces ([&](const Face& face) {
                int triangleOffset = triangleCount;
                int vertexOffset = vertexCount;
                face.EnumerateVertices ([&](double x, double y, double z) {
                    positionArr.set (vertexCount * 3, x);
                    positionArr.set (vertexCount * 3 + 1, y);
                    positionArr.set (vertexCount * 3 + 2, z);
                    vertexCount += 1;
                });
                face.EnumerateNormals ([&](double x, double y, double z) {
                    normalArr.set (normalCount * 3, x);
                    normalArr.set (normalCount * 3 + 1, y);
                    normalArr.set (normalCount * 3 + 2, z);
                    normalCount += 1;
                });
                face.EnumerateTriangles ([&](int v0, int v1, int v2) {
                    indexArr.set (triangleCount * 3, vertexOffset + v0);
                    indexArr.set (triangleCount * 3 + 1, vertexOffset + v1);
                    indexArr.set (triangleCount * 3 + 2, vertexOffset + v2);
                    triangleCount += 1;
                });""",
        """            int vertexCount = 0;
            int normalCount = 0;
            int triangleCount = 0;
            int brepFaceCount = 0;

            // Erst in C++ sammeln, dann in einem Stueck als festes Feld nach
            // JavaScript - statt jede Zahl einzeln ueber die Grenze zu reichen.
            std::vector<float> positions;
            std::vector<float> normals;
            std::vector<uint32_t> indices;
            emscripten::val brepFaceArr (emscripten::val::array ());

            mesh.EnumerateFaces ([&](const Face& face) {
                int triangleOffset = triangleCount;
                int vertexOffset = vertexCount;
                face.EnumerateVertices ([&](double x, double y, double z) {
                    positions.push_back ((float) x);
                    positions.push_back ((float) y);
                    positions.push_back ((float) z);
                    vertexCount += 1;
                });
                face.EnumerateNormals ([&](double x, double y, double z) {
                    normals.push_back ((float) x);
                    normals.push_back ((float) y);
                    normals.push_back ((float) z);
                    normalCount += 1;
                });
                face.EnumerateTriangles ([&](int v0, int v1, int v2) {
                    indices.push_back ((uint32_t) (vertexOffset + v0));
                    indices.push_back ((uint32_t) (vertexOffset + v1));
                    indices.push_back ((uint32_t) (vertexOffset + v2));
                    triangleCount += 1;
                });""")

aendere('occt-import-js/src/js-interface.cpp',
        """            emscripten::val positionObj (emscripten::val::object ());
            positionObj.set ("array", positionArr);
            attributesObj.set ("position", positionObj);

            if (vertexCount == normalCount) {
                emscripten::val normalObj (emscripten::val::object ());
                normalObj.set ("array", normalArr);
                attributesObj.set ("normal", normalObj);
            }

            emscripten::val indexObj (emscripten::val::object ());
            indexObj.set ("array", indexArr);""",
        """            // typed_memory_view zeigt nur in den Speicher von C++; mit "new"
            // entsteht daraus eine eigene Kopie, die das Ende dieser
            // Funktion ueberlebt.
            emscripten::val positionObj (emscripten::val::object ());
            positionObj.set ("array", emscripten::val::global ("Float32Array").new_ (
                emscripten::typed_memory_view (positions.size (), positions.data ())));
            attributesObj.set ("position", positionObj);

            if (vertexCount == normalCount) {
                emscripten::val normalObj (emscripten::val::object ());
                normalObj.set ("array", emscripten::val::global ("Float32Array").new_ (
                    emscripten::typed_memory_view (normals.size (), normals.data ())));
                attributesObj.set ("normal", normalObj);
            }

            emscripten::val indexObj (emscripten::val::object ());
            indexObj.set ("array", emscripten::val::global ("Uint32Array").new_ (
                emscripten::typed_memory_view (indices.size (), indices.data ())));""")

aendere('occt-import-js/src/js-interface.cpp',
        """static emscripten::val ImportFile (ImporterPtr importer, const emscripten::val& buffer, const ImportParams& params)
{
    emscripten::val resultObj (emscripten::val::object ());

    const std::vector<uint8_t>& bufferArr = emscripten::vecFromJSArray<std::uint8_t> (buffer);
    Importer::Result importResult = importer->LoadFile (bufferArr, params);
    resultObj.set ("success", importResult == Importer::Result::Success);
    if (importResult != Importer::Result::Success) {
        return resultObj;
    }

    int meshIndex = 0;
    emscripten::val rootNodeObj (emscripten::val::object ());""",
        """static emscripten::val WriteResult (ImporterPtr importer)
{
    emscripten::val resultObj (emscripten::val::object ());
    resultObj.set ("success", true);

    emscripten::val rootNodeObj (emscripten::val::object ());""")

aendere('occt-import-js/src/js-interface.cpp',
        """    resultObj.set ("root", rootNodeObj);
    resultObj.set ("meshes", meshesArr);
    return resultObj;
}
""",
        """    resultObj.set ("root", rootNodeObj);
    resultObj.set ("meshes", meshesArr);
    return resultObj;
}

static emscripten::val FailedResult ()
{
    emscripten::val resultObj (emscripten::val::object ());
    resultObj.set ("success", false);
    return resultObj;
}

static emscripten::val ImportFile (ImporterPtr importer, const emscripten::val& buffer, const ImportParams& params)
{
    // Fester Typ statt Feld fuer Feld: convertJSArrayToNumberVector kopiert
    // ein Uint8Array in einem Stueck.
    const std::vector<uint8_t> bufferArr = emscripten::convertJSArrayToNumberVector<std::uint8_t> (buffer);
    Importer::Result importResult = importer->LoadFile (bufferArr, params);
    if (importResult != Importer::Result::Success) {
        return FailedResult ();
    }
    return WriteResult (importer);
}
""")

aendere('occt-import-js/src/js-interface.cpp',
        """emscripten::val ReadFile (const std::string& format, const emscripten::val& buffer, const emscripten::val& params)""",
        """// Eine gelesene STEP-Datei bleibt hier liegen, bis die naechste kommt oder
// sie freigegeben wird. Das Einlesen ist der teure Teil; neu zerlegt ist sie
// danach in einem Bruchteil der Zeit.
static std::shared_ptr<ImporterStep> heldStep;

emscripten::val LoadStepFile (const emscripten::val& buffer, const emscripten::val& params)
{
    heldStep = std::make_shared<ImporterStep> ();
    ImportParams importParams = GetImportParams (params);
    emscripten::val result = ImportFile (heldStep, buffer, importParams);
    if (!result["success"].as<bool> ()) {
        heldStep.reset ();
    }
    return result;
}

emscripten::val RetriangulateStepFile (const emscripten::val& params)
{
    if (!heldStep) {
        return FailedResult ();
    }
    heldStep->SetParams (GetImportParams (params));
    return WriteResult (heldStep);
}

void ReleaseStepFile ()
{
    heldStep.reset ();
}

emscripten::val ReadFile (const std::string& format, const emscripten::val& buffer, const emscripten::val& params)""")

aendere('occt-import-js/src/js-interface.cpp',
        """    emscripten::function<emscripten::val, const emscripten::val&, const emscripten::val&> ("ReadBrepFile", &ReadBrepFile);
}""",
        """    emscripten::function<emscripten::val, const emscripten::val&, const emscripten::val&> ("ReadBrepFile", &ReadBrepFile);

    emscripten::function<emscripten::val, const emscripten::val&, const emscripten::val&> ("LoadStepFile", &LoadStepFile);
    emscripten::function<emscripten::val, const emscripten::val&> ("RetriangulateStepFile", &RetriangulateStepFile);
    emscripten::function<void> ("ReleaseStepFile", &ReleaseStepFile);
}""")

# ---------------------------------------------------------------- 4.
aendere('CMakeLists.txt',
        """	target_link_options (OcctImportJS PUBLIC --bind)""",
        """	target_link_options (OcctImportJS PUBLIC --bind)
	# Kein erzeugter Code (new Function): Chrome-Erweiterungen verbieten das.
	target_link_options (OcctImportJS PUBLIC -sDYNAMIC_EXECUTION=0)""")

# ---------------------------------------------------------------- 5. Fortschritt
#
# Drei Abschnitte melden ihren Stand: 1 Datei lesen, 2 in Formen umwandeln,
# 3 in Dreiecke zerlegen. Gemeldet wird ueber einen Rueckruf, den
# js-interface.cpp an die JavaScript-Funktion occtFortschritt(abschnitt,
# anteil) weiterreicht - sofern es sie gibt.

aendere('occt-import-js/src/importer-utils.hpp',
        """class VectorBuffer : public std::streambuf
{
public:
    VectorBuffer (const std::vector<uint8_t>& v);
};""",
        """#include <Message_ProgressIndicator.hxx>
#include <functional>

// Fortschritt nach aussen melden. abschnitt: 1 lesen, 2 umwandeln,
// 3 zerlegen; anteil 0..1. Ohne gesetzten Rueckruf passiert nichts.
using ProgressCallback = std::function<void (int, double)>;
void SetProgressCallback (const ProgressCallback& callback);
void ReportProgress (int phase, double fraction);

// Reicht den Stand eines OpenCascade-Algorithmus an ReportProgress weiter.
// index/count: Teilstueck einer Reihe - etwa die dritte von fuenf Formen,
// die nacheinander zerlegt werden.
class ProgressIndicator : public Message_ProgressIndicator
{
public:
    ProgressIndicator (int phase, int index = 0, int count = 1);
    virtual void Show (const Message_ProgressScope& scope, const Standard_Boolean isForce) override;

private:
    int phase;
    int index;
    int count;
};

// Gibt die Datei nicht auf einmal, sondern stueckweise heraus. So laesst
// sich mitzaehlen, wie weit der STEP-Leser schon ist.
class VectorBuffer : public std::streambuf
{
public:
    VectorBuffer (const std::vector<uint8_t>& v);

protected:
    virtual int_type underflow () override;

private:
    char* start;
    char* end;
};""")

aendere('occt-import-js/src/importer-utils.hpp',
        """bool TriangulateShape (TopoDS_Shape& shape, const ImportParams& params);""",
        """bool TriangulateShape (TopoDS_Shape& shape, const ImportParams& params, int index = 0, int count = 1);""")

aendere('occt-import-js/src/importer-utils.cpp',
        """VectorBuffer::VectorBuffer (const std::vector<uint8_t>& v)
{
    setg ((char*) v.data (), (char*) v.data (), (char*) (v.data () + v.size ()));
}""",
        """static ProgressCallback progressCallback;
static int lastPhase = 0;
static int lastPercent = -1;

void SetProgressCallback (const ProgressCallback& callback)
{
    progressCallback = callback;
    lastPhase = 0;
    lastPercent = -1;
}

void ReportProgress (int phase, double fraction)
{
    if (!progressCallback) {
        return;
    }
    // Nur volle Prozent weiterreichen - die Algorithmen melden sich viel
    // oefter, und jeder Ruf kostet einen Sprung nach JavaScript.
    int percent = (int) (fraction * 100.0);
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    if (phase == lastPhase && percent == lastPercent) {
        return;
    }
    lastPhase = phase;
    lastPercent = percent;
    progressCallback (phase, percent / 100.0);
}

ProgressIndicator::ProgressIndicator (int phase, int index, int count) :
    Message_ProgressIndicator (),
    phase (phase),
    index (index),
    count (count > 0 ? count : 1)
{

}

void ProgressIndicator::Show (const Message_ProgressScope&, const Standard_Boolean)
{
    ReportProgress (phase, (index + GetPosition ()) / count);
}

// Stueckgroesse: 1 MB. Kleiner meldet haeufiger, kostet aber mehr Spruenge.
static const size_t VectorBufferChunk = 1024 * 1024;

VectorBuffer::VectorBuffer (const std::vector<uint8_t>& v) :
    start ((char*) v.data ()),
    end ((char*) (v.data () + v.size ()))
{
    // Der Anfang des Lesefensters bleibt immer der Dateianfang - so darf der
    // Leser auch ueber eine Stueckgrenze hinweg zuruecklegen.
    char* windowEnd = (size_t) (end - start) > VectorBufferChunk ? start + VectorBufferChunk : end;
    setg (start, start, windowEnd);
}

VectorBuffer::int_type VectorBuffer::underflow ()
{
    if (gptr () < egptr ()) {
        return traits_type::to_int_type (*gptr ());
    }
    if (egptr () >= end) {
        ReportProgress (1, 1.0);
        return traits_type::eof ();
    }
    char* windowEnd = (size_t) (end - egptr ()) > VectorBufferChunk ? egptr () + VectorBufferChunk : end;
    setg (start, egptr (), windowEnd);
    ReportProgress (1, (double) (egptr () - start) / (double) (end - start));
    return traits_type::to_int_type (*gptr ());
}""")

aendere('occt-import-js/src/importer-utils.cpp',
        """bool TriangulateShape (TopoDS_Shape& shape, const ImportParams& params)""",
        """bool TriangulateShape (TopoDS_Shape& shape, const ImportParams& params, int index, int count)""")

aendere('occt-import-js/src/importer-utils.cpp',
        """    BRepTools::Clean (shape);
    BRepMesh_IncrementalMesh mesh (shape, linDeflection, Standard_False, angDeflection);""",
        """    BRepTools::Clean (shape);

    // Dieselben Werte wie der kurze Aufruf (shape, lin, false, ang), nur in
    // der Form, die einen Fortschritt annimmt.
    IMeshTools_Parameters meshParams;
    meshParams.Deflection = linDeflection;
    meshParams.Angle = angDeflection;
    meshParams.Relative = Standard_False;
    meshParams.InParallel = Standard_False;
    Handle (ProgressIndicator) progress = new ProgressIndicator (3, index, count);
    BRepMesh_IncrementalMesh mesh (shape, meshParams, progress->Start ());""")

aendere('occt-import-js/src/importer-step.cpp',
        """    if (!stepCafReader.Transfer (document)) {""",
        """    Handle (ProgressIndicator) progress = new ProgressIndicator (2);
    if (!stepCafReader.Transfer (document, progress->Start ())) {""")

aendere('occt-import-js/src/importer-xcaf.cpp',
        """        std::vector<NodePtr> children;
        for (TDF_ChildIterator it (mainLabel); it.More (); it.Next ()) {
            TDF_Label childLabel = it.Value ();
            if (IsFreeShape (childLabel, shapeTool)) {
                TopoDS_Shape shape = shapeTool->GetShape (childLabel);
                if (!TriangulateShape (shape, params)) {
                    continue;
                }
                children.push_back (std::make_shared<const XcafNode> (
                    childLabel, shapeTool, colorTool
                    ));
            }
        }

        return children;""",
        """        // Erst zaehlen, dann zerlegen: Der Fortschritt soll ueber alle
        // Formen laufen, nicht bei jeder neu von vorn.
        std::vector<TDF_Label> freeLabels;
        for (TDF_ChildIterator it (mainLabel); it.More (); it.Next ()) {
            TDF_Label childLabel = it.Value ();
            if (IsFreeShape (childLabel, shapeTool)) {
                freeLabels.push_back (childLabel);
            }
        }

        std::vector<NodePtr> children;
        for (size_t i = 0; i < freeLabels.size (); i++) {
            TDF_Label childLabel = freeLabels[i];
            TopoDS_Shape shape = shapeTool->GetShape (childLabel);
            if (!TriangulateShape (shape, params, (int) i, (int) freeLabels.size ())) {
                continue;
            }
            children.push_back (std::make_shared<const XcafNode> (
                childLabel, shapeTool, colorTool
                ));
        }

        return children;""")

aendere('occt-import-js/src/js-interface.cpp',
        """#include <emscripten/bind.h>
""",
        """#include "importer-utils.hpp"
#include <emscripten/bind.h>

// Gibt den Fortschritt an occtFortschritt (abschnitt, anteil) weiter, wenn
// die Seite oder der Worker eine solche Funktion bereitstellt. Im Worker
// laeuft der Aufruf zwar am Stueck - postMessage darin erreicht die Seite
// aber trotzdem sofort, weil die in ihrem eigenen Faden laeuft.
static void ReportToJs (int phase, double fraction)
{
    emscripten::val callback = emscripten::val::global ("occtFortschritt");
    if (callback.typeOf ().as<std::string> () == "function") {
        callback (phase, fraction);
    }
}

""")

# Rueckruf erst beim Aufruf setzen, nicht bei der Initialisierung statischer
# Variablen: Deren Reihenfolge ueber zwei Dateien hinweg ist nicht
# festgelegt, der Rueckruf koennte sonst wieder geloescht werden.
aendere('occt-import-js/src/js-interface.cpp',
        """static emscripten::val ImportFile (ImporterPtr importer, const emscripten::val& buffer, const ImportParams& params)
{""",
        """static emscripten::val ImportFile (ImporterPtr importer, const emscripten::val& buffer, const ImportParams& params)
{
    SetProgressCallback (ReportToJs);""")

aendere('occt-import-js/src/js-interface.cpp',
        """    heldStep->SetParams (GetImportParams (params));
    return WriteResult (heldStep);""",
        """    SetProgressCallback (ReportToJs);
    heldStep->SetParams (GetImportParams (params));
    return WriteResult (heldStep);""")

aendere('occt-import-js/src/importer-utils.cpp',
        """#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
""",
        """#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <IMeshTools_Parameters.hxx>
""")

# ---------------------------------------------------------------- 6. Threads
#
# Mit -DOCCT_IMPORT_THREADS=ON entsteht eine zweite Fassung,
# occt-import-js-mt.js/.wasm, die das Zerlegen in Dreiecke auf mehrere Kerne
# verteilt. Sie braucht gemeinsamen Speicher (SharedArrayBuffer), also eine
# Seite mit Cross-Origin-Isolation. Ohne Option bleibt alles einfaedig.
#
# Wie viele Threads, bestimmt die Seite: Sie uebergibt dem Modul occtPool
# (so viele Worker legt Emscripten vorab an) und ruft SetupThreads(n) auf,
# bevor das erste Modell zerlegt wird. OpenCascade bekommt einen Thread
# weniger als der Vorrat: Ein Worker, der erst waehrend der Arbeit entstehen
# muesste, kaeme nie zustande - der Faden, der ihn anlegen soll, wartet ja.

aendere('CMakeLists.txt',
        """	target_link_options (OcctImportJS PUBLIC -sDYNAMIC_EXECUTION=0)""",
        """	target_link_options (OcctImportJS PUBLIC -sDYNAMIC_EXECUTION=0)

	option (OCCT_IMPORT_THREADS "Mehrere Kerne fuer das Zerlegen" OFF)
	if (OCCT_IMPORT_THREADS)
		target_compile_options (OcctImportJS PUBLIC -pthread)
		target_link_options (OcctImportJS PUBLIC -pthread)
		target_link_options (OcctImportJS PUBLIC -sPTHREAD_POOL_SIZE=Module.occtPool)
		target_link_options (OcctImportJS PUBLIC -sDEFAULT_PTHREAD_STACK_SIZE=2MB)
		target_link_options (OcctImportJS PUBLIC -sMAXIMUM_MEMORY=4GB)
	endif ()""")

# Der Ausgabename steht weiter unten fest auf occt-import-js - fuer die
# Thread-Fassung muss er danach noch einmal gesetzt werden.
aendere('CMakeLists.txt',
        """set_target_properties(OcctImportJS PROPERTIES OUTPUT_NAME occt-import-js)""",
        """set_target_properties(OcctImportJS PROPERTIES OUTPUT_NAME occt-import-js)
if (EMSCRIPTEN AND OCCT_IMPORT_THREADS)
	set_target_properties (OcctImportJS PROPERTIES OUTPUT_NAME occt-import-js-mt)
endif ()""")

aendere('occt-import-js/src/importer-utils.cpp',
        """    meshParams.InParallel = Standard_False;""",
        """#ifdef __EMSCRIPTEN_PTHREADS__
    meshParams.InParallel = Standard_True;
#else
    meshParams.InParallel = Standard_False;
#endif""")

aendere('occt-import-js/src/js-interface.cpp',
        """#include "importer-utils.hpp"
#include <emscripten/bind.h>
""",
        """#include "importer-utils.hpp"
#include <emscripten/bind.h>
#include <OSD_ThreadPool.hxx>

// Legt die Groesse des Thread-Vorrats von OpenCascade fest. Muss vor dem
// ersten parallelen Zerlegen kommen - danach steht der Vorrat. Gibt zurueck,
// wie viele Threads tatsaechlich arbeiten; in der einfaedigen Fassung 1.
static int SetupThreads (int count)
{
#ifdef __EMSCRIPTEN_PTHREADS__
    if (count < 1) {
        count = 1;
    }
    const Handle (OSD_ThreadPool)& pool = OSD_ThreadPool::DefaultPool (count);
    return pool->NbThreads ();
#else
    (void) count;
    return 1;
#endif
}
""")

aendere('occt-import-js/src/js-interface.cpp',
        """    emscripten::function<void> ("ReleaseStepFile", &ReleaseStepFile);""",
        """    emscripten::function<void> ("ReleaseStepFile", &ReleaseStepFile);
    emscripten::function<int, int> ("SetupThreads", &SetupThreads);""")

# ---------------------------------------------------------------- 7. Zaehler
#
# Beim Zerlegen in Dreiecke verteilt OpenCascade die Flaechen auf die Threads;
# eine einzelne grosse Flaeche rechnet aber immer ein Thread allein, und das
# kann Minuten dauern. Der Fortschritt oben (Message_ProgressIndicator) rueckt
# in der Zeit kaum: Er zaehlt in festen Anteilen je Flaeche, und Meldungen aus
# den Hilfs-Threads erreichen JavaScript nicht.
#
# Deshalb ein paar Zaehler im Speicher, die die Threads beim Arbeiten
# fortschreiben: Flaechen gesamt/fertig/in Arbeit, Nachbesserungs-Durchgang,
# aktueller Schritt (Punkte einfuegen, Dreiecke pruefen, Raender bereinigen)
# mit seinem Stand. Die Seite liest sie in der Thread-Fassung direkt aus dem
# gemeinsamen Speicher mit (GetMeshStats liefert die Ansicht darauf) - ohne
# dass jemand JavaScript aufrufen muss. Am Rechnen selbst aendert das nichts.

def neue_datei(datei, inhalt):
    pfad = os.path.join(QUELLE, datei)
    if os.path.exists(pfad):
        raise SystemExit('GIBT ES SCHON: ' + datei)
    io.open(pfad, 'w', encoding='utf-8', newline='\n').write(inhalt)

neue_datei('occt/src/BRepMesh/BRepMesh_Statistik.hxx', """// Zaehler fuer eine Fortschrittsanzeige beim Zerlegen in Dreiecke.
// Ergaenzung fuer den 3D Model Auto-Downloader, nicht Teil von OpenCascade.
// Alle Werte werden "relaxed" geschrieben: Sie dienen nur der Anzeige.
#ifndef _BRepMesh_Statistik_HeaderFile
#define _BRepMesh_Statistik_HeaderFile

#include <atomic>

enum BRepMesh_StatistikFeld
{
  BRepMesh_Stat_Lauf = 0,          // zaehlt jedes Zerlegen hoch
  BRepMesh_Stat_FlaechenGesamt,    // Flaechen der Form, die gerade dran ist
  BRepMesh_Stat_FlaechenFertig,
  BRepMesh_Stat_FlaechenAktiv,     // gerade in Arbeit
  BRepMesh_Stat_Durchgang,         // 0 erstes Netz, 1..11 Nachbesserung
  BRepMesh_Stat_Schritt,           // 1 Punkte einfuegen, 2 Dreiecke pruefen,
                                   // 3 Raender bereinigen, 4 Kanten zerlegen,
                                   // 5 Flaechenpunkte erzeugen, 6 Punkte
                                   // einordnen (innen/aussen), 7 aufraeumen
  BRepMesh_Stat_SchrittFertig,
  BRepMesh_Stat_SchrittGesamt,
  BRepMesh_Stat_Punkte,            // eingefuegte Punkte, alle Flaechen
  BRepMesh_Stat_Form,              // die wievielte Form gerade zerlegt wird
  BRepMesh_Stat_Formen,            // wie viele Formen dieser Lauf hat
  BRepMesh_Stat_Anzahl
};

extern std::atomic<int> BRepMesh_Statistik[BRepMesh_Stat_Anzahl];

inline void BRepMesh_StatSetze (int theFeld, int theWert)
{
  BRepMesh_Statistik[theFeld].store (theWert, std::memory_order_relaxed);
}

inline void BRepMesh_StatPlus (int theFeld, int theWert)
{
  BRepMesh_Statistik[theFeld].fetch_add (theWert, std::memory_order_relaxed);
}

// Schritt mit bekannter Groesse beginnen.
inline void BRepMesh_StatSchritt (int theSchritt, int theGesamt)
{
  BRepMesh_StatSetze (BRepMesh_Stat_SchrittFertig, 0);
  BRepMesh_StatSetze (BRepMesh_Stat_SchrittGesamt, theGesamt);
  BRepMesh_StatSetze (BRepMesh_Stat_Schritt, theSchritt);
}

#endif
""")

neue_datei('occt/src/BRepMesh/BRepMesh_Statistik.cxx', """// Siehe BRepMesh_Statistik.hxx.
#include <BRepMesh_Statistik.hxx>

std::atomic<int> BRepMesh_Statistik[BRepMesh_Stat_Anzahl];
""")

# Flaechen: in Arbeit, fertig. Zu Beginn jeder Flaeche zaehlt das erste Netz.
aendere('occt/src/BRepMesh/BRepMesh_FaceDiscret.cxx',
        """#include <OSD_Parallel.hxx>
""",
        """#include <OSD_Parallel.hxx>
#include <BRepMesh_Statistik.hxx>
""")
aendere('occt/src/BRepMesh/BRepMesh_FaceDiscret.cxx',
        """    Message_ProgressScope aFaceScope(myRanges[theFaceIndex], NULL, 1);
    myAlgo->process(theFaceIndex, aFaceScope.Next());""",
        """    Message_ProgressScope aFaceScope(myRanges[theFaceIndex], NULL, 1);
    BRepMesh_StatPlus (BRepMesh_Stat_FlaechenAktiv, 1);
    BRepMesh_StatSetze (BRepMesh_Stat_Durchgang, 0);
    myAlgo->process(theFaceIndex, aFaceScope.Next());
    BRepMesh_StatPlus (BRepMesh_Stat_FlaechenAktiv, -1);
    BRepMesh_StatPlus (BRepMesh_Stat_FlaechenFertig, 1);""")

# Wie viele Flaechen die Form hat, zaehlt BRepMesh selbst am genauesten.
aendere('occt/src/BRepMesh/BRepMesh_FaceDiscret.cxx',
        """  FaceListFunctor aFunctor(this, theRange);
  OSD_Parallel::For""",
        """  BRepMesh_StatSetze (BRepMesh_Stat_FlaechenGesamt, myModel->FacesNb());
  BRepMesh_StatSetze (BRepMesh_Stat_FlaechenFertig, 0);
  FaceListFunctor aFunctor(this, theRange);
  OSD_Parallel::For""")

# Nachbesserung: Durchgang und das Pruefen der Dreiecke.
aendere('occt/src/BRepMesh/BRepMesh_DelaunayDeflectionControlMeshAlgo.hxx',
        """#include <BRepMesh_GeomTool.hxx>
""",
        """#include <BRepMesh_GeomTool.hxx>
#include <BRepMesh_Statistik.hxx>
""")
aendere('occt/src/BRepMesh/BRepMesh_DelaunayDeflectionControlMeshAlgo.hxx',
        """      // Iterate on current triangles
      IMeshData::IteratorOfMapOfInteger aTriangleIt(this->getStructure()->ElementsOfDomain());
      for (; aTriangleIt.More(); aTriangleIt.Next())
      {
        const BRepMesh_Triangle& aTriangle = this->getStructure()->GetElement(aTriangleIt.Key());
        splitTriangleGeometry(aTriangle);
      }""",
        """      // Iterate on current triangles
      BRepMesh_StatSetze (BRepMesh_Stat_Durchgang, aPass);
      BRepMesh_StatSchritt (2, this->getStructure()->ElementsOfDomain().Extent());
      Standard_Integer aGeprueft = 0;
      IMeshData::IteratorOfMapOfInteger aTriangleIt(this->getStructure()->ElementsOfDomain());
      for (; aTriangleIt.More(); aTriangleIt.Next())
      {
        const BRepMesh_Triangle& aTriangle = this->getStructure()->GetElement(aTriangleIt.Key());
        splitTriangleGeometry(aTriangle);
        if ((++aGeprueft & 1023) == 0)
        {
          BRepMesh_StatSetze (BRepMesh_Stat_SchrittFertig, aGeprueft);
        }
      }""")

# Punkte einfuegen - das erste Netz wie jeder Durchgang -, danach die Raender.
aendere('occt/src/BRepMesh/BRepMesh_Delaun.cxx',
        """#include <BRepMesh_Delaun.hxx>
""",
        """#include <BRepMesh_Delaun.hxx>
#include <BRepMesh_Statistik.hxx>
""")
aendere('occt/src/BRepMesh/BRepMesh_Delaun.cxx',
        """  Message_ProgressScope aPS(theRange, "Create triangles on new vertices", anUpper);
  for (; anIndex <= anUpper; ++anIndex, aPS.Next())
  {
    if (!aPS.More())
    {
      return;
    }""",
        """  Message_ProgressScope aPS(theRange, "Create triangles on new vertices", anUpper);
  const Standard_Integer aErster = anIndex;
  BRepMesh_StatSchritt (1, anUpper - anIndex + 1);
  for (; anIndex <= anUpper; ++anIndex, aPS.Next())
  {
    if (!aPS.More())
    {
      return;
    }
    if (((anIndex - aErster + 1) & 255) == 0)
    {
      BRepMesh_StatSetze (BRepMesh_Stat_SchrittFertig, anIndex - aErster + 1);
      BRepMesh_StatPlus (BRepMesh_Stat_Punkte, 256);
    }""")
aendere('occt/src/BRepMesh/BRepMesh_Delaun.cxx',
        """      createTriangles( aVertexIdx, aLoopEdges );
    }
  }

  ProcessConstraints();
}""",
        """      createTriangles( aVertexIdx, aLoopEdges );
    }
  }

  BRepMesh_StatSchritt (3, 0);
  ProcessConstraints();
}""")

# Raender: Zwei Durchgaenge mit je zwei Schleifen ueber alle Randkanten -
# beim ersten Netz einer Flaeche mit langen, fein geteilten Raendern (etwa
# einem Gewinde) kann das eine Minute dauern.
aendere('occt/src/BRepMesh/BRepMesh_Delaun.cxx',
        """  for ( Standard_Integer aPass = 1; aPass <= 2; ++aPass )
  {      
    // 1 pass): find external triangles on boundary edges;
    // 2 pass): find external triangles on boundary edges appeared 
    //          during triangles replacement.
    
    IMeshData::IteratorOfMapOfInteger aFrontierIt( *aFrontier );
    for ( ; aFrontierIt.More(); aFrontierIt.Next() )
    {
      Standard_Integer aFrontierId = aFrontierIt.Key();""",
        """  Standard_Integer aRand = 0;
  BRepMesh_StatSchritt (3, 4 * aFrontier->Extent());
  for ( Standard_Integer aPass = 1; aPass <= 2; ++aPass )
  {      
    // 1 pass): find external triangles on boundary edges;
    // 2 pass): find external triangles on boundary edges appeared 
    //          during triangles replacement.
    
    IMeshData::IteratorOfMapOfInteger aFrontierIt( *aFrontier );
    for ( ; aFrontierIt.More(); aFrontierIt.Next() )
    {
      if ((++aRand & 63) == 0)
      {
        BRepMesh_StatSetze (BRepMesh_Stat_SchrittFertig, aRand);
      }
      Standard_Integer aFrontierId = aFrontierIt.Key();""")
aendere('occt/src/BRepMesh/BRepMesh_Delaun.cxx',
        """    for ( aFrontierIt.Reset(); aFrontierIt.More(); aFrontierIt.Next() )
    {
      Standard_Integer aFrontierId = aFrontierIt.Key();
      if ( !myMeshData->ElementsConnectedTo( aFrontierId ).IsEmpty() )
        continue;""",
        """    for ( aFrontierIt.Reset(); aFrontierIt.More(); aFrontierIt.Next() )
    {
      if ((++aRand & 63) == 0)
      {
        BRepMesh_StatSetze (BRepMesh_Stat_SchrittFertig, aRand);
      }
      Standard_Integer aFrontierId = aFrontierIt.Key();
      if ( !myMeshData->ElementsConnectedTo( aFrontierId ).IsEmpty() )
        continue;""")

# Erstes Netz, nach den Raendern: aufraeumen, Punkte im Inneren der Flaeche
# erzeugen, jeden davon gegen den Rand pruefen. Das Pruefen kostet je Punkt
# so viel, wie der Rand Kanten hat - bei langen Raendern der teuerste Teil.
aendere('occt/src/BRepMesh/BRepMesh_DelaunayBaseMeshAlgo.cxx',
        """#include <BRepMesh_DelaunayBaseMeshAlgo.hxx>
""",
        """#include <BRepMesh_DelaunayBaseMeshAlgo.hxx>
#include <BRepMesh_Statistik.hxx>
""")
aendere('occt/src/BRepMesh/BRepMesh_DelaunayBaseMeshAlgo.cxx',
        """  BRepMesh_MeshTool aCleaner(aStructure);
  aCleaner.EraseFreeLinks();""",
        """  BRepMesh_StatSchritt (7, 0);
  BRepMesh_MeshTool aCleaner(aStructure);
  aCleaner.EraseFreeLinks();""")
aendere('occt/src/BRepMesh/BRepMesh_DelaunayNodeInsertionMeshAlgo.hxx',
        """#include <BRepMesh_NodeInsertionMeshAlgo.hxx>
""",
        """#include <BRepMesh_NodeInsertionMeshAlgo.hxx>
#include <BRepMesh_Statistik.hxx>
""")
aendere('occt/src/BRepMesh/BRepMesh_DelaunayNodeInsertionMeshAlgo.hxx',
        """    if (!myIsPreProcessSurfaceNodes)
    {
      const Handle(IMeshData::ListOfPnt2d) aSurfaceNodes =""",
        """    if (!myIsPreProcessSurfaceNodes)
    {
      BRepMesh_StatSchritt (5, 0);
      const Handle(IMeshData::ListOfPnt2d) aSurfaceNodes =""")
aendere('occt/src/BRepMesh/BRepMesh_DelaunayNodeInsertionMeshAlgo.hxx',
        """    IMeshData::VectorOfInteger aVertexIndexes(theNodes->Size(), this->getAllocator());
    IMeshData::ListOfPnt2d::Iterator aNodesIt(*theNodes);
    for (Standard_Integer aNodeIt = 1; aNodesIt.More(); aNodesIt.Next(), ++aNodeIt)
    {
      const gp_Pnt2d& aPnt2d = aNodesIt.Value();
      if (this->getClassifier()->Perform(aPnt2d) == TopAbs_IN)""",
        """    IMeshData::VectorOfInteger aVertexIndexes(theNodes->Size(), this->getAllocator());
    IMeshData::ListOfPnt2d::Iterator aNodesIt(*theNodes);
    BRepMesh_StatSchritt (6, theNodes->Size());
    for (Standard_Integer aNodeIt = 1; aNodesIt.More(); aNodesIt.Next(), ++aNodeIt)
    {
      if ((aNodeIt & 255) == 0)
      {
        BRepMesh_StatSetze (BRepMesh_Stat_SchrittFertig, aNodeIt);
      }
      const gp_Pnt2d& aPnt2d = aNodesIt.Value();
      if (this->getClassifier()->Perform(aPnt2d) == TopAbs_IN)""")

# Kanten: Bevor die Flaechen beginnen, zerlegt BRepMesh die Raender jeder
# Form. Und vor der ersten Form: Zaehler auf null, Flaechen aller Formen
# zusammenzaehlen.
aendere('occt-import-js/src/importer-utils.cpp',
        """    BRepTools::Clean (shape);
""",
        """    BRepTools::Clean (shape);
    BRepMesh_StatSetze (BRepMesh_Stat_Form, index + 1);
    BRepMesh_StatSetze (BRepMesh_Stat_Formen, count);
    BRepMesh_StatSetze (BRepMesh_Stat_FlaechenGesamt, 0);
    BRepMesh_StatSetze (BRepMesh_Stat_FlaechenFertig, 0);
    BRepMesh_StatSchritt (4, 0);
""")
aendere('occt-import-js/src/importer-utils.cpp',
        """#include <IMeshTools_Parameters.hxx>
""",
        """#include <IMeshTools_Parameters.hxx>
#include <BRepMesh_Statistik.hxx>
""")
aendere('occt-import-js/src/importer-xcaf.cpp',
        """        std::vector<NodePtr> children;
        for (size_t i = 0; i < freeLabels.size (); i++) {""",
        """        for (int feld = BRepMesh_Stat_FlaechenGesamt; feld < BRepMesh_Stat_Anzahl; feld++) {
            BRepMesh_StatSetze (feld, 0);
        }
        BRepMesh_StatSetze (BRepMesh_Stat_Formen, (int) freeLabels.size ());
        BRepMesh_StatPlus (BRepMesh_Stat_Lauf, 1);

        std::vector<NodePtr> children;
        for (size_t i = 0; i < freeLabels.size (); i++) {""")
aendere('occt-import-js/src/importer-xcaf.cpp',
        """#include "importer-xcaf.hpp"
""",
        """#include "importer-xcaf.hpp"
#include <BRepMesh_Statistik.hxx>
""")

# Fuer JavaScript: eine Int32Array-Ansicht auf die Zaehler. In der Thread-
# Fassung liegt sie auf gemeinsamem Speicher und laesst sich von der Seite
# mitlesen, waehrend der Worker rechnet.
aendere('occt-import-js/src/js-interface.cpp',
        """#include <OSD_ThreadPool.hxx>
""",
        """#include <OSD_ThreadPool.hxx>
#include <BRepMesh_Statistik.hxx>

static_assert (sizeof (std::atomic<int>) == sizeof (int), "Zaehler muessen als Int32Array lesbar sein");

static emscripten::val GetMeshStats ()
{
    return emscripten::val (emscripten::typed_memory_view (
        (size_t) BRepMesh_Stat_Anzahl, reinterpret_cast<int*> (BRepMesh_Statistik)));
}
""")
aendere('occt-import-js/src/js-interface.cpp',
        """    emscripten::function<int, int> ("SetupThreads", &SetupThreads);""",
        """    emscripten::function<int, int> ("SetupThreads", &SetupThreads);
    emscripten::function<emscripten::val> ("GetMeshStats", &GetMeshStats);
""")

# ---------------------------------------------------------------- 8. Null-Kreise
#
# Manche STEP-Dateien speichern einen Vollkreis als Kante, deren Anfang und
# Ende am selben Punkt liegen, mit dem Bereich "von x bis x". OpenCascade
# liest daraus einen Kreis der Laenge null: Der Flaeche fehlt dieser Rand,
# und das Zerlegen spannt Dreiecke quer ueber sie (gefunden an
# spool-gear-hub-fixed-side-unite.stp aus dem Prusa Spool Bot - die innere
# Zylinderwand wurde zum Kegel).
#
# Nach dem Einlesen: solche Kanten auf den vollen Umlauf setzen. Das macht
# die Flaeche nicht in jedem Fall fehlerfrei (beim Zahnrad bleiben einzelne
# Dreiecke falsch; die Randkurven in der Flaechenebene liegen dort zum Teil um
# einen Umlauf versetzt, und sie zurueckzusetzen liess das Zerlegen der
# Flaeche in dieser OpenCascade-Fassung ganz scheitern). Deshalb zaehlt die
# Bibliothek mit: reparierte Kanten und Flaechen, die sich gar nicht zerlegen
# liessen. GetImportWarnings gibt beides heraus, die Seite weist dann auf eine
# fehlerhafte Datei hin. Dateien ohne solche Kanten bleiben unberuehrt.

aendere('occt-import-js/src/importer-step.cpp',
        """#include <TDocStd_Document.hxx>
#include <STEPCAFControl_Reader.hxx>
""",
        """#include <TDocStd_Document.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <TDF_LabelSequence.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <BRep_Tool.hxx>
#include <BRep_Builder.hxx>
#include <BRepLib.hxx>
#include <Geom_Curve.hxx>

// Kanten mit periodischer Kurve (Kreis, Ellipse ...), deren Bereich leer ist,
// obwohl Anfangs- und Endpunkt zusammenfallen: Gemeint ist der volle Umlauf.
// Wie viele Kanten beim letzten Einlesen repariert wurden - die Seite
// meldet dann, dass die Datei fehlerhaft ist (GetImportWarnings).
int repairedEdgeCount = 0;

static bool RepairZeroLengthClosedEdges (const TopoDS_Shape& shape)
{
    TopTools_IndexedMapOfShape edges;
    TopExp::MapShapes (shape, TopAbs_EDGE, edges);
    BRep_Builder builder;
    bool repaired = false;
    for (int i = 1; i <= edges.Extent (); i++) {
        const TopoDS_Edge& edge = TopoDS::Edge (edges (i));
        if (BRep_Tool::Degenerated (edge)) {
            continue;
        }
        Standard_Real first = 0.0;
        Standard_Real last = 0.0;
        Handle (Geom_Curve) curve = BRep_Tool::Curve (edge, first, last);
        if (curve.IsNull () || !curve->IsPeriodic () || Abs (last - first) > 1.0e-6) {
            continue;
        }
        TopoDS_Vertex v1;
        TopoDS_Vertex v2;
        TopExp::Vertices (edge, v1, v2);
        if (v1.IsNull () || v2.IsNull ()) {
            continue;
        }
        Standard_Real gap = BRep_Tool::Pnt (v1).Distance (BRep_Tool::Pnt (v2));
        if (gap > Max (1.0e-4, BRep_Tool::Tolerance (v1) + BRep_Tool::Tolerance (v2))) {
            continue;
        }
        builder.Range (edge, first, first + curve->Period ());
        BRepLib::SameParameter (edge, 1.0e-5);
        repaired = true;
        repairedEdgeCount++;
    }
    return repaired;
}

static void RepairShapes (const Handle (TDocStd_Document)& document)
{
    Handle (XCAFDoc_ShapeTool) shapeTool = XCAFDoc_DocumentTool::ShapeTool (document->Main ());
    TDF_LabelSequence labels;
    shapeTool->GetFreeShapes (labels);
    repairedEdgeCount = 0;
    for (Standard_Integer i = 1; i <= labels.Length (); i++) {
        TopoDS_Shape shape = shapeTool->GetShape (labels.Value (i));
        if (!shape.IsNull ()) {
            RepairZeroLengthClosedEdges (shape);
        }
    }
}
""")
aendere('occt-import-js/src/importer-step.cpp',
        """    if (!stepCafReader.Transfer (document, progress->Start ())) {
        return false;
    }
""",
        """    if (!stepCafReader.Transfer (document, progress->Start ())) {
        return false;
    }
    RepairShapes (document);
""")

# Flaechen, die sich nicht zerlegen liessen (BRepMesh laesst sie still weg),
# zaehlen - je Lauf, zurueckgesetzt zusammen mit den Zaehlern oben.
aendere('occt-import-js/src/importer-utils.cpp',
        """    Handle (ProgressIndicator) progress = new ProgressIndicator (3, index, count);
    BRepMesh_IncrementalMesh mesh (shape, meshParams, progress->Start ());
    return true;
}""",
        """    Handle (ProgressIndicator) progress = new ProgressIndicator (3, index, count);
    BRepMesh_IncrementalMesh mesh (shape, meshParams, progress->Start ());

    for (TopExp_Explorer faceIt (shape, TopAbs_FACE); faceIt.More (); faceIt.Next ()) {
        TopLoc_Location location;
        if (BRep_Tool::Triangulation (TopoDS::Face (faceIt.Current ()), location).IsNull ()) {
            emptyFaceCount++;
        }
    }
    return true;
}""")
aendere('occt-import-js/src/importer-utils.cpp',
        """#include <BRepMesh_Statistik.hxx>
""",
        """#include <BRepMesh_Statistik.hxx>
#include <BRep_Tool.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopLoc_Location.hxx>
#include <Poly_Triangulation.hxx>

// Flaechen ohne Zerlegung im letzten Lauf, siehe GetImportWarnings.
int emptyFaceCount = 0;
""")
aendere('occt-import-js/src/importer-xcaf.cpp',
        """        BRepMesh_StatSetze (BRepMesh_Stat_Formen, (int) freeLabels.size ());
        BRepMesh_StatPlus (BRepMesh_Stat_Lauf, 1);""",
        """        BRepMesh_StatSetze (BRepMesh_Stat_Formen, (int) freeLabels.size ());
        BRepMesh_StatPlus (BRepMesh_Stat_Lauf, 1);
        extern int emptyFaceCount;
        emptyFaceCount = 0;""")

# Fuer JavaScript: { reparierteKanten, leereFlaechen } des letzten Laufs.
aendere('occt-import-js/src/js-interface.cpp',
        """static emscripten::val GetMeshStats ()
{""",
        """extern int repairedEdgeCount;
extern int emptyFaceCount;

static emscripten::val GetImportWarnings ()
{
    emscripten::val result (emscripten::val::object ());
    result.set ("reparierteKanten", repairedEdgeCount);
    result.set ("leereFlaechen", emptyFaceCount);
    return result;
}

static emscripten::val GetMeshStats ()
{""")
aendere('occt-import-js/src/js-interface.cpp',
        """    emscripten::function<emscripten::val> ("GetMeshStats", &GetMeshStats);""",
        """    emscripten::function<emscripten::val> ("GetMeshStats", &GetMeshStats);
    emscripten::function<emscripten::val> ("GetImportWarnings", &GetImportWarnings);""")

print('alle Aenderungen angewandt')
